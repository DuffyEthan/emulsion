# Emulsion

A layered, Photoshop-style image editor that runs entirely on this machine.
No network, no accounts — everything (pixels, projects, exports) stays local.

There are two ways to run it:

- **Desktop app** — download it for macOS or Windows (below).
- **In a browser** — the editor itself is plain HTML/CSS/JS with no build
  step and no dependencies, so you can just open `index.html`:

  ```
  open index.html        # macOS
  start index.html       # Windows
  ```

See `ARCHITECTURE.md` for how the design maps onto Photoshop's real internals.

## Download the desktop app

Prefer a real app with its own window and Dock/Start-menu icon? Grab the
latest build from the
**[Releases page](https://github.com/DuffyEthan/emulsion/releases/latest)**:

| Platform | File |
| --- | --- |
| macOS (Apple Silicon + Intel) | `Emulsion-<version>-mac-universal.dmg` |
| Windows installer | `Emulsion-Setup-<version>.exe` (auto-picks x64/ARM64), or the smaller `-x64.exe` / `-arm64.exe` |
| Windows, no install | `Emulsion-Portable-<version>.exe` |

The desktop app is the exact same editor wrapped in
[Electron](https://www.electronjs.org/) — still fully offline, no network
access, nothing leaves your machine.

> **First launch on an unsigned build:** macOS — right-click the app →
> **Open** (or System Settings → Privacy & Security → **Open Anyway**).
> Windows — on the SmartScreen prompt click **More info → Run anyway**.

### Building the desktop app yourself

The browser version still needs nothing; Node.js is only required for the
desktop wrapper (`desktop/main.js`).

```
npm install
npm start              # run Emulsion in a desktop window
npm run dist:mac       # -> dist/*.dmg, *.zip   (run on a Mac)
npm run dist:win       # -> dist/*.exe          (run on Windows)
```

### Publishing a release

`.github/workflows/desktop.yml` builds both platforms on GitHub's runners.
Push a version tag and the installers are attached to a new GitHub Release:

```
git tag v1.0.0 && git push origin v1.0.0
```

(Or run the workflow manually from the Actions tab to just get the files as
build artifacts.) To ship signed/notarized builds, add the repository
secrets `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` and/or
`WIN_CERT_P12_BASE64`, `WIN_CERT_PASSWORD`; without them the builds are
unsigned but work.

## What it does

- **Layers** — add, duplicate, delete, reorder, rename, hide, merge down,
  flatten; per-layer opacity and **all 27 Photoshop CS6 blend modes** (the
  16 PDF-spec modes run natively on Canvas2D; Dissolve, Linear Burn/Dodge,
  Darker/Lighter Color, Vivid/Linear/Pin Light, Hard Mix, Subtract and
  Divide are composited per-pixel).
- **Layer masks** — reveal all / hide all / from selection; paint on the
  mask (black hides, white reveals), apply or delete it. Works on
  adjustment layers too, not just pixel layers.
- **Layer styles** — Drop Shadow, Inner Shadow, Outer Glow, Stroke and
  Color Overlay, live and non-destructive, with a CS6-style dialog (the
  `fx` badge on a layer row opens it).
- **Adjustment layers** (Layer > New Adjustment Layer) — real,
  non-destructive Photoshop-style layers: Brightness/Contrast, Levels,
  Curves, Exposure, Vibrance, Hue/Saturation, Color Balance, Black &
  White, Photo Filter, Posterize, Threshold, Gradient Map and Invert.
  Each recomputes its effect live from whatever is beneath it every time
  the document renders — nothing is baked into pixels — with its own
  opacity, blend mode, visibility and (paintable) layer mask, exactly
  like a normal layer. Double-click a layer's thumbnail in the Layers
  panel to re-edit it. They can't be painted on, filtered, or
  free-transformed themselves (there are no pixels to touch); Merge Down
  / Flatten bakes them into the raster layer(s) below, same as Photoshop.
- **Adjustments** (Adjust menu) — the same math as above, plus Desaturate,
  Auto Tone and Auto Contrast, as one-shot **destructive** edits to the
  active pixel layer: Brightness/Contrast, **Levels** (histogram,
  per-channel), **Curves** (interactive spline editor, per-channel),
  Exposure, Vibrance, Hue/Saturation, Color Balance, Black & White, Photo
  Filter, Invert, Desaturate, Posterize, Threshold, Gradient Map, Auto
  Tone, Auto Contrast — all with live preview, all selection-aware.
- **Filters** — Gaussian/Box/Motion/Radial blur, Unsharp Mask, Add Noise,
  Median, Mosaic, Twirl, Pinch, Ripple, Clouds, Difference Clouds, Emboss,
  Find Edges, Solarize, High Pass.
- **17 tools** with Photoshop keybindings — Move (V), Marquee M
  (rectangle & ellipse), Lasso (L), Magic Wand (W), Crop (C), Eyedropper
  (I), Brush (B), Clone Stamp (S, ⌥-click sets the source), Eraser (E),
  Paint Bucket (G), Gradient R (linear & radial), Dodge & Burn (O
  toggles), Text (T), Shape U (rect / rounded / ellipse / line), Hand
  (H), Zoom (Z).
- **Free Transform** (⌘T) — scale from any handle, rotate outside the
  box, move inside it; ⇧ constrains; Enter/double-click applies, Esc
  cancels.
- **Align to canvas** (Layer menu) and **Move-tool smart guides** — align
  the active layer to the canvas's edges/center, or drag it near one with
  the Move tool (arrow keys nudge 1px, ⇧-arrow nudges 10px) and it snaps
  with a guide line. Both are content-aware: they align/snap the layer's
  actual visible artwork, not its raw (often padded) canvas rectangle —
  trimming transparent margin when there is any, or a uniform border
  color (à la Image > Trim) when the layer has no transparency at all,
  e.g. a flattened photo or JPEG import — so a loosely-cropped imported
  image still centers correctly.
- **Selections** — marquee, lasso and wand with marching ants; feather;
  inverse; they constrain painting, fills, filters, delete and
  copy/paste. Raster selections get their ant outlines from a contour
  trace of the mask.
- **Document ops** — Image Size, Canvas Size (anchored), crop tool and
  Crop-to-Selection, image rotation (90°/180°) and canvas/layer flips.
- **Editing** — Fill dialog (⇧F5-style contents + opacity), Stroke
  selection, multi-step undo/redo with a clickable history panel.
- **Files** — open PNG/JPEG/WebP or real Photoshop **.psd** files (or
  drop them into the window; a drop becomes a new layer if a document is
  open), export PNG/JPEG/**PSD**, and save/reopen layered projects as
  `.emulsion` files (masks, layer styles and adjustment layers included).
- **PSD** — `js/psd.js` is a from-scratch reader/writer (no libraries):
  opening a `.psd` rebuilds real layers with their name, position,
  opacity, blend mode, visibility and layer mask; exporting writes a
  standard 8-bit RGB `.psd` (RLE-compressed layers + a flattened
  composite) that reopens correctly in actual Photoshop. Threshold,
  Posterize and Invert adjustment layers round-trip as real, still-
  editable Emulsion adjustment layers (matching Photoshop's own on-disk
  layout for these three); exporting one of Emulsion's *other*
  adjustment-layer types (Levels, Curves, Hue/Saturation, …), which have
  no PSD encoding this codec writes, bakes it into a rendered layer
  instead so the file still looks right, at the cost of that one layer's
  non-destructive editing — the layers underneath stay intact in the
  file either way. Known gaps: ZIP-compressed channels (re-save from
  Photoshop with RLE compression instead), PSB (Large Document Format),
  16-/32-bit-per-channel precision (downsampled to 8-bit on import),
  layer groups (imported as a flat stack, in stacking order), type
  layers (imported as their rendered pixels, not re-editable text), and
  other adjustment/fill layer types Photoshop itself writes (Solid
  Color, Gradient Fill, Levels, Curves, …), which use Photoshop's
  generic "Descriptor" structure this codec doesn't parse and so are
  dropped on import rather than guessed at. Layer styles and clipping
  masks aren't stored in `.psd` at all; use `.emulsion` to round-trip
  those losslessly.

Not implemented (the parts of CS6 that don't fit a single-file local
build): Content-Aware fill/move, Puppet Warp, Liquify, the Blur Gallery,
Camera Raw, 3D and video layers, smart objects, vector pen paths (shapes
rasterize), and actions/batch.

## Keyboard reference

On Windows, use **Ctrl** wherever ⌘ appears and **Alt** for ⌥.

| Keys | Action |
|---|---|
| V M L W C I B S E G R O T U H Z | switch tools (O toggles Dodge/Burn) |
| `[` / `]` | brush smaller / larger |
| X / D | swap / reset foreground–background colors |
| ⌥-click (paint tools) | temporary eyedropper · (clone) set source |
| Arrow keys (Move tool) | nudge active layer 1px · ⇧ nudges 10px |
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
js/core.js     document & layer model, compositor (27 blend modes, masks,
               styles, adjustment layers, content-aware align/snap),
               selection & contour tracing, history, free transform,
               document geometry
js/filters.js  FilterSession (live-preview model), gaussian blur, USM
js/adjust.js   the Adjust menu: levels, curves, vibrance, color balance,
               black & white, photo filter, exposure, …; ADJUSTMENT_TYPES,
               the shared registry (label/fields/defaults/apply) that
               both the Adjust menu's destructive dialogs and Layer >
               New Adjustment Layer's live layers are built from
js/fx.js       the Filter menu: motion/radial blur, noise, median,
               mosaic, distorts, clouds, emboss, high pass, …
js/tools.js    the seventeen tools
js/psd.js      real .psd reader/writer (PackBits RLE, layer records,
               blend-mode key mapping, masks) — no dependencies
js/io.js       open/export images, .emulsion project format, wires
               js/psd.js into FileReader/Blob
js/ui.js       viewport, panels, menus & submenus, dialogs (levels
               histogram, curves editor, layer styles), input routing
desktop/       Electron desktop wrapper & packaging config (optional)
```
