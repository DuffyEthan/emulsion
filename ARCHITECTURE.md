# How Photoshop is built — and how Emulsion maps onto it

Research notes for building a private, fully-local Photoshop-style editor.
(Web searching for "Photoshop architecture" mostly returns tutorials about
architectural rendering *in* Photoshop; the engineering picture below is
assembled from Adobe's published references — the PSD format spec, the blend
mode math standardized in ISO 32000/PDF, and what Adobe has said publicly
about the product's internals — plus Photopea as the proof that the whole
model fits in a browser.)

## Photoshop's actual architecture

**Core + plugin host.** Photoshop is a C++ core with a plugin architecture
(historically "PICA"); filters, file formats, and even some built-in tools are
plugins against a stable API. The UI is a shell over a document/engine core.

**Tile-based virtual image memory.** Images are not one big buffer. Each
layer's pixels are split into fixed-size tiles managed by a virtual-memory
system that pages tiles between RAM and the scratch disk. This is what lets
Photoshop edit images far larger than RAM, and it makes many operations
(undo, compositing, caching) tile-granular. A resolution pyramid of
downsampled tiles backs fast zoomed-out display.

**The layer stack and compositing.** A document is an ordered stack of
layers; each layer has pixels (or parametric content), an opacity, a blend
mode, masks, and optional effects. Compositing walks the stack bottom-up:
each layer is combined with the accumulated backdrop using Porter–Duff
"over" plus a blend function. The blend-mode math (multiply, screen,
overlay, color-dodge/burn, soft/hard light, difference, exclusion, and the
non-separable hue/saturation/color/luminosity modes) is the same algebra
Adobe standardized in the PDF spec — it's public and exact.

**Non-destructive re-editing.** Adjustment layers are deferred operations —
a stored parameter set applied during compositing rather than baked into
pixels. Smart objects embed the original data plus a replayable transform.
Both are "recipe, not result" designs.

**History.** Undo is command-pattern plus copy-on-write tile snapshots:
a history state only stores the tiles a stroke actually touched, which is
why even huge documents undo instantly. History is capped and memory-bounded.

**GPU.** Since CS6 the "Mercury Graphics Engine" moves compositing, zoom
interpolation, and many filters to the GPU (OpenGL/OpenCL, now Metal/DX).

**PSD format.** A header (dimensions, depth, color mode), color-mode data,
image resources, a layer-and-mask section (per-layer rects, channels, blend
key, opacity, masks), and a flattened composite for compatibility.

## Emulsion: same shape, browser-native materials

| Photoshop | Emulsion |
|---|---|
| C++ core + plugin host | Vanilla JS modules sharing a small core (`js/core.js`) |
| Tiled virtual memory + scratch disk | One offscreen `<canvas>` per layer (documents that fit in RAM) |
| Mercury GPU compositing | Canvas2D compositing — GPU-accelerated by the browser |
| PDF-spec blend modes | The *same* modes, natively implemented by Canvas2D (`multiply` … `luminosity`) |
| Command pattern + tile COW snapshots | Command entries with before/after snapshots of only the touched layer |
| Selections as channels/masks | Selection as vector `Path2D` + rasterized mask, used as clip + filter mask |
| Adjustment dialogs w/ live preview | FilterSession: cached original → recompute per slider move → commit/cancel |
| PSD file format | `js/psd.js` — a real reader/writer for the format described below, plus `.emulsion` (JSON + per-layer PNG data URLs) as Emulsion's own lossless project format |
| Creative Cloud | Nothing. No network calls, no telemetry, no accounts. `file://` is the deployment target. |

The one deliberate simplification: layers are document-sized bitmaps with an
(x, y) offset instead of tiled sparse storage. That trades "5-gigapixel
documents" (which need tiling) for a dramatically simpler engine, while
keeping the layer/blend/history model faithful.

## The CS6 expansion (July 2026)

Bringing Emulsion to CS6 feature parity forced four Photoshop mechanisms
to be implemented rather than borrowed from the browser:

**All 27 blend modes.** Canvas2D natively supplies the sixteen PDF-spec
modes. The other eleven (Dissolve, Linear Burn/Dodge, Darker/Lighter
Color, Vivid/Linear/Pin Light, Hard Mix, Subtract, Divide) are computed
per-pixel with the standard Porter–Duff form
`co = (αs(1−αb)·cs + αb(1−αs)·cb + αs·αb·B(cb,cs)) / αo` — a layer using
one of these takes a slow path through `blendManualOnto()`; everything
else stays on the GPU.

**Raster selections.** The wand and feathering produce masks, not
polygons, but marching ants need a path. `traceMaskToPts()` walks the
pixel-edge boundary of the ≥50% contour (every boundary edge emitted with
the inside on a consistent side, so loops close and holes wind opposite)
and collinear runs collapse to vertices. The soft mask itself is kept for
painting/fill/filter clipping, so feathered edges survive; ants sit at
the 50% threshold, exactly like Photoshop.

**Layer styles.** Non-destructive effects recomputed at composite time
from the layer's alpha: silhouette → GPU `ctx.filter: blur()` → offset
draw (shadow/glow behind), inverse-silhouette blur clipped to alpha
(inner shadow), 16-direction dilation minus alpha (stroke), silhouette
tint (overlay). Nothing touches the layer's pixels.

**Free transform.** A live session (`PS.transform`) previewed by the
compositor via a canvas matrix; scaling solves `R·S·(u_handle−u_anchor) =
q_mouse−q_anchor` so the opposite handle stays pinned; commit resamples
once into a new bitmap and records a single history entry.

Layer masks reuse the mask-as-alpha-canvas idea (`destination-in` at
composite), with painting routed to the mask when its thumbnail is
targeted — black hides, white reveals, exact per-pixel math at commit.

## Non-destructive adjustment layers (September 2026)

Every other Emulsion layer is a bitmap; an adjustment layer
(`isAdjustmentLayer(L)` in core.js) is deliberately the odd one out —
`L.canvas` is always `null`, and `L.adjustment = {type, params}` is a
parameter block instead. The compositor treats that as a distinct case
from the start: `compositeLayerOnto()` checks `isAdjustmentLayer(L)`
before anything else and, if true, calls `renderAdjustmentSurface(L,
ctx)`, which reads back the backdrop already composited into `ctx` (i.e.
everything below this layer), runs the adjustment function over a copy
of it, and masks that result exactly like `renderLayerSurface` masks a
real layer (the same `destination-in` trick, so a soft/feathered mask
works identically). The result lands in `PS.tmpA`, and from there it
rejoins the *exact* code path a normal layer would take — the same
blend-mode dispatch to a native Canvas2D op or `blendManualOnto()`, the
same opacity multiply — so opacity, blend mode and masking on an
adjustment layer are not special-cased twice; they fall out of reusing
the normal layer's second half. Because the effect is recomputed from
the live backdrop on every composite (never written into a bitmap
anywhere), moving, hiding, or editing a layer below an adjustment layer
updates it immediately, with no cache to invalidate — "non-destructive"
here is just "there was never a destructive step."

One registry (`ADJUSTMENT_TYPES` in adjust.js) drives everything built on
top of that: `label` for menus, `defaults`/`fields` for a generic
slider/select/checkbox dialog (`adjustmentLayerDialog` in ui.js, which is
`filterDialog` with the `FilterSession` swapped out for direct
`L.adjustment.params` mutation — same live-preview shape, different
target), and `apply(data, w, h, params)` wrapping the very same
`adjThreshold`/`adjLevels`/… functions the destructive Adjust menu calls.
Levels, Curves and Color Balance keep their existing bespoke editors
(histogram, spline, per-tone-range state) rather than fitting the generic
field list — `adjustmentLayerLevelsDialog`/`Curves`/`ColorBalance` are
near-verbatim copies of the destructive dialogs with the `FilterSession`
calls replaced the same way.

Everywhere else in the app that assumed every layer has real pixels
needed one guard, not a rewrite: `FilterSession`'s constructor refuses an
adjustment layer (which is *the* choke point — it silently disables every
Filter-menu entry and every destructive Adjust-menu dialog for the
active layer, since they all construct a `FilterSession`), and a handful
of core.js operations that touch `L.canvas` directly (fill, clear
selection, copy, free transform, crop/resize/rotate's per-layer resample)
either refuse outright (nothing to fill or transform) or skip the
canvas step while still moving/resampling the layer's mask, which is a
real bitmap regardless of layer kind. `mergeDown()`/`flattenImage()`
needed no changes at all — they already composited pairs of layers
through `compositeLayerOnto()` onto a scratch canvas, so once that
function understood adjustment layers, merging one down bakes it into
whatever is below for free, the same way Photoshop's Merge Down does.

## Reading and writing real .psd files (September 2026)

`js/psd.js` implements Adobe's actual on-disk format directly against
`ArrayBuffer`/`DataView` — no parser library, matching the zero-dependency
constraint. The format is exactly the "header, color-mode data, image
resources, layer-and-mask section, composite image data" shape described
above; the implementation is a straight read of that shape:

**Layer order needs no reversal.** PSD stores layer records bottom-to-top
in the file — the same order `doc.layers[0..n]` already uses — so import
and export map 1:1 onto the array with no flip.

**PackBits, not DEFLATE.** Photoshop's default per-channel compression is
PackBits RLE (a byte-oriented run-length scheme), which is small enough
to hand-write both directions (`packBitsRow` / `unpackBitsInto`) — raw
(uncompressed) channels are read too, but ZIP-compressed channels
(compression IDs 2/3) are rejected with a message telling the user to
re-save with RLE, rather than shipping an inflate implementation for a
compression mode Photoshop rarely defaults to.

**Blend modes round-trip through a fixed key table.** PSD identifies a
blend mode by a 4-character signature (`'mul '` = Multiply, `'sLit'` =
Soft Light, …) rather than a name; `PSD_BLEND_TO_KEY` / `PSD_BLEND_FROM_KEY`
are the exact inverse of each other so a mode set in Emulsion, exported,
and reopened lands on the same mode.

**Length-prefixed sections are backpatched.** PSD nests
length-then-bytes sections (the layer-and-mask section contains a
layer-info section, which contains per-layer records, which contain
per-channel image data blocks) but a channel's compressed byte length is
only known after encoding it. The writer (`makePSDWriter`) reserves a
4-byte slot with `reserveU32()`, keeps writing, then calls `u32At()` to
fill in the true length once the section closes — the same trick every
native PSD writer uses, just done by hand.

**Fidelity is bounded on purpose.** Layer groups, type/smart-object
layers, and any color mode besides RGB/Grayscale/Indexed/CMYK don't have
an equivalent in Emulsion's flat raster-layer model, so import either
flattens them into their rendered pixels or (for genuinely unsupported
modes like Lab or Bitmap) raises a clear error asking the user to
convert in Photoshop first. Layer effects and clipping masks are
Emulsion-only concepts with no simple PSD encoding here, so they survive
`.emulsion` round-trips but not `.psd` ones — the same "recipe you'd lose
on this path" tradeoff PSD itself makes with Smart Objects on other
tools.

**Adjustment layers round-trip as real layers, not baked pixels.** A
real PSD adjustment layer (Threshold, Levels, Curves, …) has no pixels of
its own — a 0×0 rect and a parameter block in additional layer info — so
an early cut of this codec that treated "no pixels" as "nothing to
import" silently dropped the layer and its effect entirely (a real
reported bug: "the threshold layers aren't carried over"). Once Emulsion
grew actual non-destructive adjustment layers (see the section above),
the fix stopped being about pixels at all: for the types with a simple,
fully-understood fixed byte layout (`'thrs'` Threshold, `'post'`
Posterize, `'invr'` Invert — `PSD_ADJUSTMENT_KEY_TO_TYPE`), import just
builds a real `{adjustment: {type, params}}` layer, the same shape
`createAdjustmentLayer` produces natively, so it opens still-editable and
composites live like any other adjustment layer. Export mirrors this
exactly for the same three types (`encodeAdjustmentLayerForPSD`) — 0×0
rect, empty channels, a real `'thrs'`/`'post'`/`'invr'` info block —
so a round trip through Emulsion opens back up in actual Photoshop as a
live adjustment layer too. For an Emulsion adjustment-layer type PSD
export can't encode (Levels, Curves, Hue/Saturation, …, since Photoshop
stores those via a generic nested "Descriptor" structure this codec
doesn't write), `bakeAdjustmentForExport()` reuses `compositeLayerOnto()`
again — composite everything below, then composite this one layer on
top of that snapshot — and writes the result as an ordinary raster
layer at that stack position, so the file still looks right even though
that one layer loses non-destructive editability; the layers underneath
stay in the file, just visually covered. On the *import* side, the
equivalent Descriptor-based adjustment/fill layer types Photoshop itself
writes (Solid Color, Gradient Fill, Levels, Curves, …) are still dropped
rather than guessed at — guessing a binary layout wrong would silently
corrupt the result, which is worse than the documented gap.

## Align to canvas and Move-tool smart guides (September 2026)

Both features need the same underlying question answered: "where is this
layer's content?" A layer's canvas is frequently *not* a tight crop of
its visible pixels — an imported image centered-and-scaled-to-fit inside
a differently-proportioned document, a pasted selection padded to the
clipboard's bounds, anything drawn off-true within its own layer — so
the first version of alignment (aligning the raw canvas rectangle) put
the visible artwork visibly off-center whenever that padding was
lopsided, which is exactly backwards from what "align center" should do.

`getOpaqueBounds(canvas)` (core.js) answers the real question instead: a
single alpha-channel scan for the tight bounding box of non-transparent
pixels, in the canvas's own local coordinates (falling back to the full
canvas only when there's no opaque content at all, e.g. a blank new
layer — nothing to trim to). `alignLayer()` computes the delta between
that content box's current position and its target edge/center, then
moves the *whole* layer (`L.x`/`L.y`) by that delta — so the canvas and
its mask, which stays aligned with the canvas by construction, both move
together, and the content lands exactly on the target regardless of how
much transparent margin surrounds it.

The Move tool's smart-guide snapping (`computeMoveSnap()`, tools.js)
reuses the identical bounds, computed once at drag-start rather than per
pointer-move (an O(w·h) alpha scan is fine as a one-off but not at frame
rate): the proposed canvas position is translated to a proposed content
position, snapped against the canvas's edges/center within a small
screen-space threshold, then translated back. Both the align commands
and the drag snap therefore agree on where a layer's content actually
is, and both are blocked on an adjustment layer for the same reason
Free Transform is — there's no `L.canvas` to measure.

The alpha scan alone isn't enough, though: a flattened photo, a JPEG
import, or any PNG saved with a solid background instead of real
transparency has no alpha=0 pixels anywhere, so "trim to non-transparent
pixels" trivially returns the entire canvas — no better than not
trimming at all. `getOpaqueBounds()` detects that case (no transparent
pixel found during its scan) and falls back to `getTrimmedBounds()`,
which does what Photoshop's Image > Trim does with "corner color": if
all four corners agree on a color within a small tolerance, treat that
as the background and find the tight box of pixels that differ from it.
A photo with a plain background therefore still aligns by its subject; a
genuinely uniform solid-color layer (no subject at all) correctly falls
back to the full canvas rather than collapsing to nothing.

Neither pass is a strict min/max over every matching pixel, though — that
turned out not to be robust. A stray mark far from the real subject (a
watermark, a scanner speck, a leftover non-transparent pixel from a
sloppy export — visibly present in the reported bug's source image, as a
couple of small marks near a corner) silently drags a strict bounding
box out to meet it, which looks like the *first* fix doing nothing:
alignment still visibly misses the subject, just now for a different
reason. `boundsFromContentPredicate()` builds the box from row/column
projection *counts* instead of a single matching pixel: a row or column
only counts toward the box once more than a small fraction of it matches
the content predicate, since a real subject's stroke or fill width spans
far more of a row than a few stray marks ever would. Both
`getOpaqueBounds()`'s alpha pass and `getTrimmedBounds()`'s corner-color
pass share this one function, so both are equally robust to this failure
mode; if every row and column is that sparse (a hairline diagonal, say)
it falls back to the strict any-pixel box rather than reporting no
content.
