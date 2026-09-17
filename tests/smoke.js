'use strict';
/* Headless smoke test: drives the engine through a real editing session.
   Open tests/smoke.html and eyeball the screenshot — or run:
   chrome --headless=new --screenshot smoke.html */

function assert(cond, msg) {
  if (!cond) {
    console.error('SMOKE FAIL: ' + msg);
    document.title = 'SMOKE FAIL: ' + msg;
    throw new Error(msg);
  }
}

setTimeout(() => {
  PS.projectName = 'Smoke';
  newDocument(900, 600, 'white');
  afterDocChange();

  // 1. brush stroke on the background layer
  PS.fg = '#2a6df0';
  PS.toolOpts.size = 40;
  PS.toolOpts.hardness = 0.7;
  PS.toolOpts.opacity = 1;
  selectTool('brush');
  Tools.brush.onDown({ x: 90, y: 430 });
  for (let i = 1; i <= 50; i++) {
    const a = i / 50;
    Tools.brush.onMove({ x: 90 + 720 * a, y: 430 - 260 * Math.sin(a * Math.PI) });
  }
  Tools.brush.onUp();
  assert(History.undoStack.length === 2, 'brush stroke recorded in history');

  // 2. new layer, gradient, multiply blend
  addLayer('Wash');
  PS.fg = '#f0a43c'; PS.bg = '#ffffff';
  Tools.gradient.onDown({ x: 0, y: 0 });
  Tools.gradient.onMove({ x: 900, y: 600 });
  Tools.gradient.onUp({ x: 900, y: 600 });
  setLayerProps(activeLayer(), { blendMode: 'multiply', opacity: 0.85 }, 'Blend mode');
  assert(PS.doc.layers.length === 2, 'second layer exists');

  // 3. marquee selection + fill, constrained to the selection
  setSelection([rectPts(560, 60, 260, 170)]);
  PS.fg = '#3fa66a';
  fillWithColor(PS.fg);

  // 4. selection-aware gaussian blur on the background layer
  PS.doc.activeIndex = 0;
  const s = new FilterSession('Gaussian blur');
  assert(s.valid, 'filter session valid');
  s.apply((d, w, h) => gaussianBlur(d, w, h, 8));
  s.commit();

  // 5. undo/redo round-trip
  const depth = History.undoStack.length;
  History.undo();
  History.redo();
  assert(History.undoStack.length === depth, 'undo/redo round-trip');
  clearSelection();

  // 6. CS6 adjustments through FilterSession
  const lev = new FilterSession('Levels');
  lev.apply((d, w, h) => adjLevels(d, w, h, { channel: 'rgb', inB: 10, gamma: 1.2, inW: 245, outB: 0, outW: 255 }));
  lev.commit();
  const lut = curveLUT([{ x: 0, y: 0 }, { x: 255, y: 255 }]);
  assert(Math.abs(lut[128] - 128) <= 1, 'identity curve LUT is identity');
  const vib = new FilterSession('Vibrance');
  vib.apply((d, w, h) => adjVibrance(d, w, h, 30, 0));
  vib.commit();

  // 7. manual blend mode path (linear dodge) composites without error
  setLayerProps(PS.doc.layers[1], { blendMode: 'linear-dodge' }, 'Blend mode');
  compositeDoc();
  const px = PS.flatCtx.getImageData(450, 300, 1, 1).data;
  assert(px[3] === 255, 'manual blend composite produced opaque pixel');
  setLayerProps(PS.doc.layers[1], { blendMode: 'multiply' }, 'Blend mode');

  // 8. magic wand on the flat green fill + feather (raster selections)
  PS.toolOpts.tolerance = 40;
  PS.toolOpts.contiguous = true;
  magicWandSelect({ x: 640, y: 140 });
  assert(PS.doc.selection, 'wand created a selection');
  const wb = PS.doc.selection.bounds;
  assert(wb.w >= 200 && wb.w <= 320 && wb.h >= 120 && wb.h <= 220,
    'wand bounds match the filled rect, got ' + wb.w + 'x' + wb.h);
  featherSelection(6);
  assert(PS.doc.selection && PS.doc.selection.mask, 'feathered selection kept raster mask');
  clearSelection();

  // 9. layer mask: hide-all mask makes the wash layer invisible
  PS.doc.activeIndex = 1;
  addLayerMask('hide');
  assert(activeLayer().mask, 'layer mask exists');
  compositeDoc();
  removeLayerMask(false);
  assert(!activeLayer().mask, 'layer mask removed');

  // 10. layer styles render (drop shadow + stroke)
  setLayerStyles(activeLayer(), {
    shadow: { on: true, color: '#000000', opacity: 60, angle: 120, dist: 8, size: 12 },
    stroke: { on: true, color: '#f0a43c', opacity: 100, size: 3 },
  });
  compositeDoc();
  setLayerStyles(activeLayer(), null);

  // 11. free transform: scale + rotate the wash layer
  const beforeW = activeLayer().canvas.width;
  beginFreeTransform();
  PS.transform.sx = 0.6;
  PS.transform.sy = 0.6;
  PS.transform.rot = 0.35;
  commitFreeTransform();
  assert(activeLayer().canvas.width !== beforeW, 'free transform reshaped the layer');
  History.undo();

  // 12. crop + undo, canvas rotate + undo
  cropDocument(100, 80, 500, 400);
  assert(PS.doc.width === 500 && PS.doc.height === 400, 'crop resized document');
  History.undo();
  assert(PS.doc.width === 900 && PS.doc.height === 600, 'crop undo restored size');
  rotateCanvasDoc('rot90');
  assert(PS.doc.width === 600 && PS.doc.height === 900, 'canvas rotate swapped dimensions');
  History.undo();
  assert(PS.doc.width === 900, 'canvas rotate undo restored');

  // 13. fx functions execute on a small buffer
  const tiny = new ImageData(64, 64);
  for (let i = 0; i < tiny.data.length; i += 4) {
    tiny.data[i] = (i / 4) % 255; tiny.data[i + 1] = 128; tiny.data[i + 2] = 64; tiny.data[i + 3] = 255;
  }
  motionBlur(tiny.data, 64, 64, 30, 10);
  radialBlur(tiny.data, 64, 64, 30, 'zoom');
  mosaic(tiny.data, 64, 64, 8);
  medianFilter(tiny.data, 64, 64, 2);
  addNoise(tiny.data, 64, 64, 10, true);
  twirl(tiny.data, 64, 64, 90);
  pinch(tiny.data, 64, 64, 40);
  embossFx(tiny.data, 64, 64, 135, 100);
  findEdges(tiny.data, 64, 64);
  highPass(tiny.data, 64, 64, 4);
  renderClouds(tiny.data, 64, 64, '#000000', '#ffffff', false);
  adjBlackWhite(tiny.data, 64, 64, { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 });
  adjColorBalance(tiny.data, 64, 64, [10, 0, -10], [0, 5, 0], [-5, 0, 5]);
  adjPhotoFilter(tiny.data, 64, 64, '#ec8a00', 25, true);
  adjPosterize(tiny.data, 64, 64, 4);
  adjGradientMap(tiny.data, 64, 64, '#000000', '#ffffff', false);

  refreshPanels();
  requestRender();

  // 14. PSD round-trip: build a .psd from the current 2-layer document
  // (giving the top layer a mask first), re-parse it, and check dimensions,
  // blend mode, opacity, mask and pixels all survive.
  PS.doc.activeIndex = PS.doc.layers.length - 1;
  addLayerMask('hide');
  const psdBuf = buildPSD(PS.doc);
  const psd = parsePSD(psdBuf);
  assert(psd.width === PS.doc.width && psd.height === PS.doc.height, 'PSD round-trip kept document size');
  const rtLayers = psdLayersToEmulsion(psd);
  assert(rtLayers.length === PS.doc.layers.length, 'PSD round-trip kept layer count');
  const origTop = PS.doc.layers[PS.doc.layers.length - 1];
  const rtTop = rtLayers[rtLayers.length - 1];
  assert(rtTop.blendMode === origTop.blendMode, 'PSD round-trip kept blend mode, got ' + rtTop.blendMode);
  assert(Math.abs(rtTop.opacity - origTop.opacity) < 0.01, 'PSD round-trip kept opacity');
  const op = ctx2d(origTop.canvas).getImageData(10, 10, 1, 1).data;
  const rp = ctx2d(rtTop.canvas).getImageData(10, 10, 1, 1).data;
  assert(op[0] === rp[0] && op[1] === rp[1] && op[2] === rp[2] && op[3] === rp[3], 'PSD round-trip kept pixel data');
  assert(rtTop.mask, 'PSD round-trip kept the layer mask');
  const mp = ctx2d(rtTop.mask).getImageData(5, 5, 1, 1).data;
  assert(mp[0] < 10, 'PSD round-trip mask kept "hide all" (black) value, got ' + mp[0]);
  removeLayerMask(false);

  // 15. Native non-destructive adjustment layers (Photoshop-style): a
  // Threshold adjustment layer stacked over a raster layer must affect the
  // composite live without touching the raster layer's own pixels, and
  // masking/opacity/visibility must work exactly like a normal layer.
  (() => {
    PS.projectName = 'AdjLayer';
    newDocument(4, 4, 'transparent');
    const doc = PS.doc;
    const base = doc.layers[0];
    const bctx = ctx2d(base.canvas);
    const bid = bctx.createImageData(4, 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const i = (y * 4 + x) * 4;
      const v = x < 2 ? 50 : 200; // left half dark, right half light
      bid.data[i] = bid.data[i + 1] = bid.data[i + 2] = v; bid.data[i + 3] = 255;
    }
    bctx.putImageData(bid, 0, 0);
    const rawBefore = bctx.getImageData(0, 0, 1, 1).data.slice();

    const adj = createAdjustmentLayer('threshold', { level: 128 });
    doc.layers.push(adj);
    doc.activeIndex = 1;
    compositeDoc();
    let dark = PS.flatCtx.getImageData(0, 0, 1, 1).data;
    let light = PS.flatCtx.getImageData(3, 0, 1, 1).data;
    assert(dark[0] === 0, 'adjustment layer thresholded the dark half live, got ' + dark[0]);
    assert(light[0] === 255, 'adjustment layer thresholded the light half live, got ' + light[0]);
    const rawAfter = bctx.getImageData(0, 0, 1, 1).data;
    assert(rawAfter[0] === rawBefore[0], 'adjustment layer left the raster layer\'s own pixels untouched, got ' + rawAfter[0] + ' vs ' + rawBefore[0]);

    adj.visible = false;
    compositeDoc();
    dark = PS.flatCtx.getImageData(0, 0, 1, 1).data;
    assert(dark[0] === 50, 'hiding the adjustment layer restored the unadjusted backdrop, got ' + dark[0]);
    adj.visible = true;

    doc.activeIndex = 1;
    addLayerMask('hide');
    compositeDoc();
    dark = PS.flatCtx.getImageData(0, 0, 1, 1).data;
    assert(dark[0] === 50, 'a "hide all" mask on the adjustment layer suppresses its effect, got ' + dark[0]);
    removeLayerMask(false);

    // export/import round trip through the real .psd codec
    const buf = buildPSD(doc);
    const rtPsd = parsePSD(buf);
    const rtLayers = psdLayersToEmulsion(rtPsd);
    assert(rtLayers.length === 2, 'PSD round-trip kept both the raster and adjustment layer, got ' + rtLayers.length);
    const rtAdj = rtLayers[1];
    assert(rtAdj.adjustment && rtAdj.adjustment.type === 'threshold', 'PSD round-trip kept a real Threshold adjustment layer, got ' + JSON.stringify(rtAdj.adjustment));
    assert(rtAdj.adjustment.params.level === 128, 'PSD round-trip kept the threshold level, got ' + rtAdj.adjustment.params.level);
  })();

  // 16. Import fidelity against a hand-built PSD shaped exactly like real
  // Photoshop's own output (0x0 rect, empty channels, a 'thrs' info
  // block) — regression test for a reported bug where Threshold layers
  // weren't carried over at all; now they must come back as a real,
  // still-editable adjustment layer, not baked/flattened pixels.
  (() => {
    const tw = 4, th = 4;
    const baseCanvas = mkCanvas(tw, th);
    const bid = new ImageData(tw, th);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const i = (y * tw + x) * 4;
      const v = x < 2 ? 50 : 200; // left half dark, right half light
      bid.data[i] = bid.data[i + 1] = bid.data[i + 2] = v; bid.data[i + 3] = 255;
    }
    ctx2d(baseCanvas).putImageData(bid, 0, 0);
    const baseLayer = { name: 'Base', x: 0, y: 0, canvas: baseCanvas, mask: null, opacity: 1, blendMode: 'normal', visible: true };
    const enc = encodeLayerForPSD(baseLayer);

    const pw = makePSDWriter();
    pw.str('8BPS'); pw.u16(1); pw.pad(6);
    pw.u16(4); pw.u32(th); pw.u32(tw); pw.u16(8); pw.u16(3);
    pw.u32(0); pw.u32(0);
    const lmAt = pw.reserveU32(); const lmStart = pw.here();
    const liAt = pw.reserveU32(); const liStart = pw.here();
    pw.i16(2);

    pw.i32(0); pw.i32(0); pw.i32(th); pw.i32(tw);
    pw.u16(enc.channels.length);
    for (const ch of enc.channels) { pw.i16(ch.id); pw.u32(ch.buf.byteLength); }
    pw.str('8BIM'); pw.str('norm'); pw.u8(255); pw.u8(0); pw.u8(0); pw.u8(0);
    let exAt = pw.reserveU32(); let exStart = pw.here();
    pw.u32(0); pw.u32(0);
    pw.u8(4); pw.str('Base'); pw.pad((4 - (5 % 4)) % 4);
    pw.u32At(exAt, pw.here() - exStart);

    pw.i32(0); pw.i32(0); pw.i32(0); pw.i32(0);
    pw.u16(4);
    pw.i16(0); pw.u32(2); pw.i16(1); pw.u32(2); pw.i16(2); pw.u32(2); pw.i16(-1); pw.u32(2);
    pw.str('8BIM'); pw.str('norm'); pw.u8(255); pw.u8(0); pw.u8(0); pw.u8(0);
    exAt = pw.reserveU32(); exStart = pw.here();
    pw.u32(0); pw.u32(0);
    const nm2 = 'Threshold 1';
    pw.u8(nm2.length); pw.str(nm2); pw.pad((4 - ((1 + nm2.length) % 4)) % 4);
    pw.str('8BIM'); pw.str('thrs'); pw.u32(2); pw.u16(128);
    pw.u32At(exAt, pw.here() - exStart);

    for (const ch of enc.channels) pw.bytes(ch.buf);
    for (let i = 0; i < 4; i++) pw.u16(0);

    pw.u32At(liAt, pw.here() - liStart);
    pw.u32(0);
    pw.u32At(lmAt, pw.here() - lmStart);
    writeMergedImageRLE(pw, baseCanvas, tw, th);

    const tpsd = parsePSD(pw.finish());
    const layers = psdLayersToEmulsion(tpsd);
    assert(layers.length === 2, 'Threshold layer came back as a real layer instead of being dropped, got ' + layers.length);
    assert(!layers[0].adjustment && layers[0].canvas, 'first layer is the untouched raster layer');
    assert(layers[1].adjustment && layers[1].adjustment.type === 'threshold', 'second layer is a real Threshold adjustment layer, got ' + JSON.stringify(layers[1].adjustment));
    assert(layers[1].adjustment.params.level === 128, 'threshold level carried over, got ' + layers[1].adjustment.params.level);
    assert(layers[1].canvas === null, 'adjustment layer has no baked pixels of its own');
    // and it still visually thresholds once composited, same as the source file would show
    newDocument(tw, th, 'transparent');
    PS.doc.layers = layers.map(s => s.adjustment
      ? Object.assign(createAdjustmentLayer(s.adjustment.type, s.adjustment.params), { name: s.name, opacity: s.opacity, blendMode: s.blendMode, visible: s.visible })
      : Object.assign(createLayer(s.name, tw, th, null), { canvas: s.canvas, opacity: s.opacity, blendMode: s.blendMode, visible: s.visible }));
    compositeDoc();
    const dark = PS.flatCtx.getImageData(0, 0, 1, 1).data;
    const light = PS.flatCtx.getImageData(3, 0, 1, 1).data;
    assert(dark[0] === 0, 'reconstructed document thresholds the dark half black, got ' + dark[0]);
    assert(light[0] === 255, 'reconstructed document thresholds the light half white, got ' + light[0]);
  })();

  // 17. Align to canvas + Move-tool smart-guide snapping.
  (() => {
    PS.projectName = 'Align';
    newDocument(200, 100, 'transparent');
    PS.view.zoom = 1; // deterministic snap threshold regardless of viewport size
    const doc = PS.doc;
    const L = doc.layers[0];
    L.canvas = mkCanvas(40, 20);
    ctx2d(L.canvas).fillRect(0, 0, 40, 20);
    L.x = 5; L.y = 5;

    alignLayer('h-center');
    assert(L.x === 80, 'align center horizontal centers the layer, got ' + L.x);
    alignLayer('right');
    assert(L.x === 160, 'align right flushes the layer to the right edge, got ' + L.x);
    alignLayer('left');
    assert(L.x === 0, 'align left flushes the layer to the left edge, got ' + L.x);
    alignLayer('v-center');
    assert(L.y === 40, 'align center vertical centers the layer, got ' + L.y);
    alignLayer('bottom');
    assert(L.y === 80, 'align bottom flushes the layer to the bottom edge, got ' + L.y);
    alignLayer('top');
    assert(L.y === 0, 'align top flushes the layer to the top edge, got ' + L.y);
    const depthBeforeUndo = History.undoStack.length;
    History.undo();
    assert(L.y === 80, 'align top undoes back to align bottom\'s position, got ' + L.y);
    History.redo();
    assert(History.undoStack.length === depthBeforeUndo, 'align redo restored history depth');

    // Move-tool snapping: dragging near the canvas center should snap
    // exactly onto it and report a guide line; dragging elsewhere should not.
    L.x = 78; L.y = 0; // 2px off horizontal center (80) — within the snap threshold
    doc.activeIndex = 0;
    selectTool('move');
    Tools.move.onDown({ x: 20, y: 10 });
    Tools.move.onMove({ x: 22, y: 10 }); // nudge 2px right — should snap to exact center
    assert(L.x === 80, 'move-tool drag snapped to horizontal canvas center, got ' + L.x);
    assert(PS.snapGuides && PS.snapGuides.v === 100, 'a vertical smart guide is shown at the canvas center, got ' + JSON.stringify(PS.snapGuides));
    Tools.move.onMove({ x: -28, y: 25 }); // move to (30, 15) — away from every snap target on both axes
    assert(L.x === 30 && L.y === 15, 'move-tool drag does not snap once away from every target, got ' + L.x + ',' + L.y);
    assert(!PS.snapGuides, 'no smart guide once away from every snap target');
    Tools.move.onUp();
    assert(!PS.snapGuides, 'smart guide clears on release');

    // Adjustment layers have no content to move or align.
    doc.layers.push(createAdjustmentLayer('invert'));
    doc.activeIndex = 1;
    alignLayer('left'); // must not throw, must be a no-op
    Tools.move.onDown({ x: 10, y: 10 });
    assert(!Tools.move.drag, 'move tool refuses to drag an adjustment layer');
  })();

  // 18. Content-aware alignment: a layer whose canvas has lopsided
  // transparent padding around its actual artwork must align by the
  // artwork's bounding box, not the raw canvas rect — regression test for
  // "alignment looks lopsided when the image isn't centered in its own
  // canvas". A 100-wide canvas holds a 20px-wide opaque blob sitting at
  // x=60..80 (60px of padding on the left, only 20px on the right); the
  // canvas rect's own center (x=50) is nowhere near the blob's center (x=70).
  (() => {
    PS.projectName = 'ContentAlign';
    newDocument(200, 100, 'transparent');
    const doc = PS.doc;
    const L = doc.layers[0];
    L.canvas = mkCanvas(100, 40);
    const lctx = ctx2d(L.canvas);
    lctx.fillStyle = '#000';
    lctx.fillRect(60, 10, 20, 20); // opaque blob, canvas-local x 60..80, y 10..30
    L.x = 0; L.y = 0;

    const bounds = getOpaqueBounds(L.canvas);
    assert(bounds.x === 60 && bounds.w === 20, 'opaque bounds found the blob, not the padded canvas, got ' + JSON.stringify(bounds));

    alignLayer('h-center');
    // The blob's center (L.x + 60 + 10) must land on the doc's center (100),
    // not the canvas rect's center.
    assert(L.x + 70 === 100, 'align center used the blob\'s bounds, not the raw canvas rect, got layer.x=' + L.x);
    alignLayer('left');
    assert(L.x + 60 === 0, 'align left flushed the blob (not the canvas) to the edge, got layer.x=' + L.x);

    // Move-tool snapping must use the same content bounds.
    PS.view.zoom = 1;
    L.x = -58; L.y = 0; // blob center currently at x = -58+70 = 12, far from doc center (100)
    doc.activeIndex = 0;
    selectTool('move');
    Tools.move.onDown({ x: 0, y: 0 });
    Tools.move.onMove({ x: 90, y: 0 }); // blob center would land at ~102 — within snap threshold of 100
    assert(L.x + 70 === 100, 'move-tool snap centered the blob\'s content, not the canvas rect, got layer.x=' + L.x);
    Tools.move.onUp();
  })();

  // 19. Content-aware alignment also has to work on a fully OPAQUE layer
  // (a flattened photo, a JPEG import, any PNG saved with a solid
  // background instead of real alpha transparency) — regression test for
  // a reported follow-up bug where alignment still looked lopsided after
  // #18's fix, because the layer had no transparent pixels at all for an
  // alpha scan to find. getOpaqueBounds must fall back to trimming a
  // uniform border color (Photoshop's Image > Trim approach) in that case.
  (() => {
    const w = 100, h = 40;
    const canvas = mkCanvas(w, h);
    const c = ctx2d(canvas);
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, w, h); // opaque white "background", alpha 255 everywhere
    c.fillStyle = '#000000';
    c.fillRect(60, 10, 20, 20); // the actual subject, off-center within the canvas

    const bounds = getOpaqueBounds(canvas);
    assert(bounds.x === 60 && bounds.y === 10 && bounds.w === 20 && bounds.h === 20,
      'trimmed the opaque white background down to the subject, got ' + JSON.stringify(bounds));

    // A plain, subject-less canvas (uniform color, nothing to trim to)
    // must fall back to the full canvas rather than collapsing to nothing.
    const blank = mkCanvas(w, h);
    ctx2d(blank).fillRect(0, 0, w, h);
    const blankBounds = getOpaqueBounds(blank);
    assert(blankBounds.x === 0 && blankBounds.y === 0 && blankBounds.w === w && blankBounds.h === h,
      'a uniform solid-color layer falls back to the full canvas, got ' + JSON.stringify(blankBounds));

    // And end to end: aligning a layer built from that opaque canvas
    // centers the subject, not the white canvas rect.
    PS.projectName = 'OpaqueAlign';
    newDocument(200, 100, 'transparent');
    const L = PS.doc.layers[0];
    L.canvas = canvas;
    L.x = 0; L.y = 0;
    alignLayer('h-center');
    assert(L.x + 70 === 100, 'align center trimmed the opaque background and centered the subject, got layer.x=' + L.x);
  })();

  // 20. A strict min/max bounding box is not robust to a stray mark far
  // from the real subject (a watermark, a scanner speck, a leftover
  // non-transparent pixel from a sloppy export) — regression test for a
  // reported follow-up where alignment was still visibly off after #18/#19,
  // traced to exactly this: a couple of stray marks near the corner of the
  // source image were dragging the computed bounding box (and therefore
  // the "center") away from where the real subject actually is.
  (() => {
    const w = 300, h = 200;
    const canvas = mkCanvas(w, h);
    const c = ctx2d(canvas);
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#000';
    c.fillRect(100, 50, 100, 100); // the real subject: a 100x100 square at (100,50)
    c.fillRect(10, 190, 2, 2);     // a tiny stray speck far from it, near a corner

    const bounds = getOpaqueBounds(canvas);
    assert(bounds.x === 100 && bounds.y === 50 && bounds.w === 100 && bounds.h === 100,
      'a stray speck must not drag the bounding box off the real subject, got ' + JSON.stringify(bounds));

    PS.projectName = 'NoiseRobustAlign';
    newDocument(400, 200, 'transparent');
    const L = PS.doc.layers[0];
    L.canvas = canvas;
    L.x = 0; L.y = 0;
    alignLayer('h-center');
    // subject center = L.x + 100 + 50 = L.x + 150; must land on doc center (200)
    assert(L.x + 150 === 200, 'align center used the subject\'s bounds, not the speck-skewed box, got layer.x=' + L.x);
  })();

  console.log('SMOKE OK');
  document.title = 'SMOKE OK';
}, 300);
