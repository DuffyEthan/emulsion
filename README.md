# Emulsion

A layered, Photoshop-style image editor that runs entirely on this machine.
No build step, no dependencies, no network, no accounts — open `index.html`
in a browser and everything (pixels, projects, exports) stays local.

```
open index.html        # macOS
```

See `ARCHITECTURE.md` for how the design maps onto Photoshop's real internals.

## What it does

- **Layers** — add, duplicate, delete, reorder, rename, hide, merge down,
  flatten; per-layer opacity and **all 27 Photoshop CS6 blend modes**
  (the 16 PDF-spec modes run natively on Canvas2D; Dissolve, Linear
  Burn/Dodge, Darker/Lighter Color, Vivid/Linear/Pin Light, Hard Mix,
  Subtract and Divide are composited per-pixel).
- **Layer masks** — reveal all / hide all / from selection; paint on the
  mask (black hides, white reveals), apply or delete it. Works on
  adjustment layers too, not just pixel layers.
- **Layer styles** — Drop Shadow, Inner Shadow, Outer Glow, Stroke and
  Color Overlay, live and non-destructive, with a CS6-style dialog
  (the `fx` badge on a layer row opens it).
- **Adjustment layers** — real, non-destructive Photoshop-style
  adjustment layers (Layer > New Adjustment Layer): Brightness/Contrast,
  Levels, Curves, Exposure, Vibrance, Hue/Saturation, Color Balance,
  Black & White, Photo Filter, Posterize, Threshold, Gradient Map and
  Invert. Each one recomputes its effect live from whatever is beneath
  it every time the document renders — nothing is baked into pixels —
  and has its own opacity, blend mode, visibility and (paintable) layer
  mask, exactly like a normal layer. Double-click its thumbnail in the
  Layers panel to re-edit. They can't be painted on, filtered, or
  free-transformed themselves (there are no pixels to touch); Merge
  Down / Flatten bakes them into the raster layer(s) below, same as
  Photoshop.
- **17 tools** with Photoshop keybindings — Move (V), Marquee M
  (rectangle & ellipse), Lasso (L), Magic Wand (W), Crop (C),
  Eyedropper (I), Brush (B), Clone Stamp (S, ⌥-click sets the source),
  Eraser (E), Paint Bucket (G), Gradient R (linear & radial),
  Dodge & Burn (O toggles), Text (T), Shape U (rect / rounded /
  ellipse / line), Hand (H), Zoom (Z).
- **Free Transform** (⌘T) — scale from any handle, rotate outside the
  box, move inside it; ⇧ constrains; Enter/double-click applies,
  Esc cancels.
- **Align to canvas** (Layer menu) and **Move-tool smart guides** — align
  the active layer to the canvas's edges/center, or just drag it near one
  with the Move tool and it snaps with a guide line. Both are
  content-aware: they align/snap the layer's actual visible artwork, not
  its raw (often padded) canvas rectangle — trimming transparent margin
  when there is any, or a uniform border color (à la Image > Trim) when
  the layer has no transparency at all, e.g. a flattened photo or JPEG
  import — so a loosely-cropped imported image still centers correctly.
- **Selections** — marquee, lasso and wand with marching ants; feather;
  inverse; they constrain painting, fills, filters, delete and
  copy/paste. Raster selections get their ant outlines from a
  contour trace of the mask.
- **Adjustments** — Brightness/Contrast, **Levels** (with histogram,
  per-channel), **Curves** (interactive spline editor, per-channel),
  Exposure, Vibrance, Hue/Saturation, Color Balance, Black & White,
  Photo Filter, Invert, Desaturate, Posterize, Threshold, Gradient Map,
  Auto Tone, Auto Contrast — all with live preview, all selection-aware.
  These live in the Adjust menu as one-shot destructive edits to the
  active pixel layer; all but Desaturate/Auto Tone/Auto Contrast (which
  have no Photoshop adjustment-layer equivalent either) are also
  available as non-destructive **adjustment layers**, see below.
- **Filters** — Gaussian/Box/Motion/Radial blur, Unsharp Mask,
  Add Noise, Median, Mosaic, Twirl, Pinch, Ripple, Clouds,
  Difference Clouds, Emboss, Find Edges, Solarize, High Pass.
- **Document ops** — Image Size, Canvas Size (anchored), crop tool and
  Crop-to-Selection, image rotation (90°/180°) and canvas/layer flips.
- **Editing** — Fill dialog (⇧F5-style contents + opacity), Stroke
  selection, multi-step undo/redo with a clickable history panel.
- **Files** — open PNG/JPEG/WebP or real Photoshop **.psd** files (or drop
  them into the window; a drop becomes a new layer if a document is
  open), export PNG/JPEG/**PSD**, and save/reopen layered projects as
  `.emulsion` files (masks and layer styles included).
- **PSD** — `js/psd.js` is a from-scratch reader/writer (no libraries):
  opening a `.psd` rebuilds real layers with their name, position,
  opacity, blend mode, visibility and layer mask; exporting writes a
  standard 8-bit RGB `.psd` (RLE-compressed layers + a flattened
  composite) that reopens correctly in actual Photoshop. Gaps: ZIP-
  compressed channels (re-save from Photoshop with RLE compression
  instead), PSB (Large Document Format), 16-/32-bit-per-channel
  precision (downsampled to 8-bit on import), and layer groups (imported
  as a flat stack, in stacking order). Type layers import as their
  rendered pixels (not re-editable text). Threshold, Posterize and
  Invert adjustment layers round-trip as real, still-editable Emulsion
  adjustment layers (matching Photoshop's own on-disk layout for these
  three); exporting one of Emulsion's *other* adjustment-layer types
  (Levels, Curves, Hue/Saturation, …), which have no PSD encoding this
  codec writes, bakes it into a rendered layer instead so the file still
  looks right, at the cost of that one layer's non-destructive editing —
  the layers underneath stay intact in the file either way. Other
  adjustment/fill layer types written by Photoshop itself (Solid Color,
  Gradient Fill, Levels, Curves, …) use Photoshop's generic "Descriptor"
  structure, which isn't parsed on import, so those are dropped rather
  than guessed at. Layer styles and clipping masks aren't stored in
  `.psd` at all; use `.emulsion` to round-trip those losslessly.

Not implemented (the parts of CS6 that don't fit a single-file local
build): Content-Aware fill/move, Puppet Warp, Liquify, the Blur Gallery,
Camera Raw, 3D and video layers, smart objects, vector pen paths (shapes
rasterize), and actions/batch.

## Keyboard reference

| Keys | Action |
|---|---|
| V M L W C I B S E G R O T U H Z | switch tools (O toggles Dodge/Burn) |
| `[` / `]` | brush smaller / larger |
| X / D | swap / reset foreground–background colors |
| ⌥-click (paint tools) | temporary eyedropper · (clone) set source |
| ⌘Z / ⇧⌘Z | undo / redo |
| ⌘T | free transform · Enter applies · Esc cancels |
| ⌘A ⌘D ⇧⌘I | select all / deselect / inverse |
| ⌘L ⌘M ⌘U ⌘B | Levels / Curves / Hue-Saturation / Color Balance |
| ⌘I / ⇧⌘U | invert colors / desaturate |
| ⌘J / ⇧⌘N | duplicate layer / new layer |
| Delete | clear selected pixels |
| ⌘C ⌘X ⌘V | copy / cut / paste (pastes as a new layer) |
| ⌘E | merge down |
| ⌘S | save project |
| Space-drag / wheel | pan · ⌘-wheel or pinch: zoom |
| ⌘0 / ⌘1 | fit on screen / 100% |

## Layout

```
js/core.js     document & layer model, compositor (27 blend modes,
               masks, styles, adjustment layers), selection & contour
               tracing, history, free transform, document geometry
js/filters.js  FilterSession (live-preview model), gaussian blur, USM
js/adjust.js   the Adjust menu: levels, curves, vibrance, color
               balance, black & white, photo filter, exposure, …;
               ADJUSTMENT_TYPES, the shared registry (label/fields/
               defaults/apply) that both the Adjust menu's destructive
               dialogs and Layer > New Adjustment Layer's live layers
               are built from
js/fx.js       the Filter menu: motion/radial blur, noise, median,
               mosaic, distorts, clouds, emboss, high pass, …
js/tools.js    the seventeen tools
js/psd.js      real .psd reader/writer (PackBits RLE, layer records,
               blend-mode key mapping, masks) — no dependencies
js/io.js       open/export images, .emulsion project format, wires
               js/psd.js into FileReader/Blob
js/ui.js       viewport, panels, menus & submenus, dialogs (levels
               histogram, curves editor, layer styles), input routing
```
