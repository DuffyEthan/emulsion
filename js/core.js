'use strict';
/* Emulsion core: document/layer model, compositor, selection, history.
   See ARCHITECTURE.md for how this maps onto Photoshop's real design. */

const PS = {
  doc: null,
  view: { zoom: 1, panX: 0, panY: 0 },
  fg: '#1a1a1a',
  bg: '#ffffff',
  tool: 'brush',
  toolOpts: {
    size: 24, hardness: 0.8, opacity: 1,
    tolerance: 32, contiguous: true,
    gradientType: 'fg-bg', gradientShape: 'linear',
    marqueeShape: 'rect',
    exposure: 0.5,
    shapeType: 'rectangle',
    fontSize: 48, fontFamily: 'Helvetica',
  },
  stroke: null,        // live stroke state (brush/eraser/gradient/shape preview)
  marquee: null,       // in-progress marquee rect {x0,y0,x1,y1}
  lassoPts: null,      // in-progress lasso points
  transform: null,     // free-transform session
  cropRect: null,      // pending crop {x,y,w,h}
  clone: null,         // clone stamp source {src:{x,y}, offset|null}
  clipboard: null,     // {canvas, x, y}
  snapGuides: null,    // {v, h} doc-space smart-guide lines while dragging with the Move tool
  flat: null, flatCtx: null,
  tmpA: null, tmpACtx: null,   // compositor scratch buffers
  tmpB: null, tmpBCtx: null,
  tmpC: null, tmpCCtx: null,
  dirty: false,
  layerSeq: 0,
  projectName: 'Untitled',
};

/* The full CS6 blend-mode list, in CS6 menu order. Sixteen map directly
   onto Canvas2D composite ops (same PDF-spec math); the other eleven are
   computed per-pixel by blendManualOnto(). */
const BLEND_MODES = [
  ['normal', 'Normal'], ['dissolve', 'Dissolve'],
  ['darken', 'Darken'], ['multiply', 'Multiply'], ['color-burn', 'Color Burn'],
  ['linear-burn', 'Linear Burn'], ['darker-color', 'Darker Color'],
  ['lighten', 'Lighten'], ['screen', 'Screen'], ['color-dodge', 'Color Dodge'],
  ['linear-dodge', 'Linear Dodge (Add)'], ['lighter-color', 'Lighter Color'],
  ['overlay', 'Overlay'], ['soft-light', 'Soft Light'], ['hard-light', 'Hard Light'],
  ['vivid-light', 'Vivid Light'], ['linear-light', 'Linear Light'],
  ['pin-light', 'Pin Light'], ['hard-mix', 'Hard Mix'],
  ['difference', 'Difference'], ['exclusion', 'Exclusion'],
  ['subtract', 'Subtract'], ['divide', 'Divide'],
  ['hue', 'Hue'], ['saturation', 'Saturation'],
  ['color', 'Color'], ['luminosity', 'Luminosity'],
];

const MANUAL_BLENDS = ['dissolve', 'linear-burn', 'darker-color', 'linear-dodge',
  'lighter-color', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix',
  'subtract', 'divide'];

/* Canvas composite op for a blend mode, or null if it needs the manual path. */
function blendToCanvasOp(mode) {
  if (mode === 'normal') return 'source-over';
  if (MANUAL_BLENDS.includes(mode)) return null;
  return mode;
}

/* ---------- canvas helpers ---------- */

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function ctx2d(c) {
  return c.getContext('2d', { willReadFrequently: true });
}

function cloneCanvas(src) {
  const c = mkCanvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

function ctxReset(c) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.filter = 'none';
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/* ---------- color helpers ---------- */

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

/* ---------- document & layers ---------- */

function createLayer(name, w, h, fillStyle) {
  const canvas = mkCanvas(w, h);
  if (fillStyle) {
    const c = canvas.getContext('2d');
    c.fillStyle = fillStyle;
    c.fillRect(0, 0, w, h);
  }
  return {
    id: ++PS.layerSeq,
    name, canvas,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    x: 0, y: 0,
    mask: null,          // alpha-only canvas, layer-aligned; null = no mask
    targetMask: false,   // when true, paint tools edit the mask
    styles: null,        // layer styles {shadow, innerShadow, outerGlow, stroke, overlay}
    adjustment: null,    // {type, params} for adjustment layers — see createAdjustmentLayer
  };
}

/* A Photoshop-style adjustment layer: no pixels of its own (canvas is
   always null), just a parameter block recomputed live against whatever
   is beneath it every time the document composites — see
   compositeLayerOnto()/renderAdjustmentSurface() and ADJUSTMENT_TYPES
   (adjust.js). Everything else about it (opacity, blend mode, visibility,
   mask) works exactly like a normal layer. */
function isAdjustmentLayer(L) { return !!(L && L.adjustment); }

function createAdjustmentLayer(type, params) {
  const def = ADJUSTMENT_TYPES[type];
  return {
    id: ++PS.layerSeq,
    name: def ? def.label : type,
    canvas: null,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    x: 0, y: 0,
    mask: null,
    targetMask: false,
    styles: null,
    adjustment: { type, params: params || (def ? structuredClone(def.defaults) : {}) },
  };
}

function newDocument(width, height, background) {
  width = clamp(Math.round(width), 1, 8192);
  height = clamp(Math.round(height), 1, 8192);
  const fill = background === 'transparent' ? null
             : background === 'black' ? '#000000' : '#ffffff';
  PS.doc = {
    width, height,
    layers: [createLayer('Background', width, height, fill)],
    activeIndex: 0,
    selection: null,
  };
  PS.transform = null;
  PS.cropRect = null;
  PS.clone = null;
  reallocBuffers();
  History.reset();
  requestRender();
  return PS.doc;
}

function activeLayer() {
  const d = PS.doc;
  return d ? d.layers[d.activeIndex] : null;
}

function requestRender() { PS.dirty = true; }

function reallocBuffers() {
  const d = PS.doc;
  PS.flat = mkCanvas(d.width, d.height);
  PS.flatCtx = PS.flat.getContext('2d');
  PS.tmpA = mkCanvas(d.width, d.height);
  PS.tmpACtx = ctx2d(PS.tmpA);
  PS.tmpB = mkCanvas(d.width, d.height);
  PS.tmpBCtx = PS.tmpB.getContext('2d');
  PS.tmpC = mkCanvas(d.width, d.height);
  PS.tmpCCtx = PS.tmpC.getContext('2d');
}

function layerHasStyles(L) {
  const s = L.styles;
  return !!(s && ((s.shadow && s.shadow.on) || (s.innerShadow && s.innerShadow.on) ||
    (s.outerGlow && s.outerGlow.on) || (s.stroke && s.stroke.on) ||
    (s.overlay && s.overlay.on)));
}

/* ---------- compositor ----------
   Flatten the layer stack into PS.flat, bottom (index 0) up. Simple
   layers draw straight through; anything with a mask, styles, a live
   stroke/transform, or a manual blend mode goes through a doc-sized
   surface buffer first. */

function compositeDoc() {
  const d = PS.doc;
  if (!d) return;
  const ctx = PS.flatCtx;
  ctxReset(ctx);
  ctx.clearRect(0, 0, d.width, d.height);
  for (const L of d.layers) {
    if (L.visible) compositeLayerOnto(ctx, L, true);
  }
  ctxReset(ctx);
}

function compositeLayerOnto(ctx, L, live) {
  if (isAdjustmentLayer(L)) {
    renderAdjustmentSurface(L, ctx);
    const aop = blendToCanvasOp(L.blendMode);
    if (!aop) {
      blendManualOnto(ctx, L.blendMode, L.opacity);
    } else {
      ctx.globalAlpha = L.opacity;
      ctx.globalCompositeOperation = aop;
      ctx.drawImage(PS.tmpA, 0, 0);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    return;
  }
  const op = blendToCanvasOp(L.blendMode);
  const styled = layerHasStyles(L);
  const liveStroke = live && PS.stroke && PS.stroke.layer === L;
  const liveTr = live && PS.transform && PS.transform.layer === L;
  if (op && !styled && !liveStroke && !liveTr && !L.mask) {
    ctx.globalAlpha = L.opacity;
    ctx.globalCompositeOperation = op;
    ctx.drawImage(L.canvas, L.x, L.y);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    return;
  }
  renderLayerSurface(L, live);
  if (styled) {
    drawBehindStyles(ctx, L);
    bakeOverStyles(L);
  }
  if (!op) {
    blendManualOnto(ctx, L.blendMode, L.opacity);
  } else {
    ctx.globalAlpha = L.opacity;
    ctx.globalCompositeOperation = op;
    ctx.drawImage(PS.tmpA, 0, 0);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/* Render an adjustment layer's live effect into tmpA: read the backdrop
   composited so far from ctx, run the adjustment function over a copy of
   it, then mask that result exactly like a real layer's mask (same
   destination-in trick as renderLayerSurface) so unmasked backdrop areas
   are untouched once the caller composites tmpA back over ctx. */
function renderAdjustmentSurface(L, ctx) {
  const d = PS.doc, t = PS.tmpACtx;
  ctxReset(t);
  t.clearRect(0, 0, d.width, d.height);
  const def = ADJUSTMENT_TYPES[L.adjustment.type];
  const id = ctx.getImageData(0, 0, d.width, d.height);
  if (def) def.apply(id.data, d.width, d.height, L.adjustment.params);
  t.putImageData(id, 0, 0);
  if (L.mask) {
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(L.mask, L.x, L.y);
    t.globalCompositeOperation = 'source-over';
  }
}

/* Render layer content (+ live transform/stroke preview + mask) into tmpA. */
function renderLayerSurface(L, live) {
  const d = PS.doc, t = PS.tmpACtx;
  ctxReset(t);
  t.clearRect(0, 0, d.width, d.height);
  const tr = live && PS.transform && PS.transform.layer === L ? PS.transform : null;
  if (tr) {
    t.save();
    t.imageSmoothingQuality = 'high';
    applyTransformCtx(t, tr);
    t.drawImage(tr.orig, tr.ox, tr.oy);
    t.restore();
  } else {
    t.drawImage(L.canvas, L.x, L.y);
  }
  const s = live && PS.stroke && PS.stroke.layer === L ? PS.stroke : null;
  if (s && !s.toMask) {
    const b = PS.tmpBCtx;
    ctxReset(b);
    b.clearRect(0, 0, d.width, d.height);
    b.drawImage(s.canvas, 0, 0);
    if (d.selection) {
      b.globalCompositeOperation = 'destination-in';
      b.drawImage(selectionMask(d.selection), 0, 0);
    }
    t.globalAlpha = s.opacity;
    t.globalCompositeOperation = s.mode === 'erase' ? 'destination-out' : (s.op || 'source-over');
    t.drawImage(PS.tmpB, 0, 0);
    t.globalAlpha = 1;
    t.globalCompositeOperation = 'source-over';
  }
  if (L.mask) {
    let maskSrc = L.mask, mx = L.x, my = L.y;
    if (s && s.toMask) {
      // live preview while painting the mask (quantised to reveal/hide;
      // the commit applies exact per-pixel math)
      const b = PS.tmpBCtx, c = PS.tmpCCtx;
      ctxReset(c);
      c.clearRect(0, 0, d.width, d.height);
      c.drawImage(s.canvas, 0, 0);
      if (d.selection) {
        c.globalCompositeOperation = 'destination-in';
        c.drawImage(selectionMask(d.selection), 0, 0);
      }
      ctxReset(b);
      b.clearRect(0, 0, d.width, d.height);
      b.drawImage(L.mask, L.x, L.y);
      b.globalAlpha = s.opacity;
      if (s.maskLuma < 128) b.globalCompositeOperation = 'destination-out';
      b.drawImage(PS.tmpC, 0, 0);
      ctxReset(b);
      maskSrc = PS.tmpB; mx = 0; my = 0;
    }
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(maskSrc, mx, my);
    t.globalCompositeOperation = 'source-over';
  }
}

/* Effects that render behind the layer: Drop Shadow, Outer Glow. */
function drawBehindStyles(ctx, L) {
  const st = L.styles, d = PS.doc;
  const silhouette = (color) => {
    const b = PS.tmpBCtx;
    ctxReset(b);
    b.clearRect(0, 0, d.width, d.height);
    b.drawImage(PS.tmpA, 0, 0);
    b.globalCompositeOperation = 'source-in';
    b.fillStyle = color;
    b.fillRect(0, 0, d.width, d.height);
    ctxReset(b);
  };
  const sh = st.shadow;
  if (sh && sh.on) {
    silhouette(sh.color);
    const rad = sh.angle * Math.PI / 180;
    ctx.save();
    ctx.globalAlpha = L.opacity * (sh.opacity / 100);
    if (sh.size > 0) ctx.filter = `blur(${sh.size / 2}px)`;
    ctx.drawImage(PS.tmpB, -Math.cos(rad) * sh.dist, Math.sin(rad) * sh.dist);
    ctx.restore();
  }
  const gl = st.outerGlow;
  if (gl && gl.on) {
    silhouette(gl.color);
    ctx.save();
    ctx.globalAlpha = L.opacity * (gl.opacity / 100);
    if (gl.size > 0) ctx.filter = `blur(${gl.size / 2}px)`;
    ctx.drawImage(PS.tmpB, 0, 0);
    ctx.drawImage(PS.tmpB, 0, 0);   // double pass thickens the glow
    ctx.restore();
  }
}

/* Effects baked onto the surface: Inner Shadow, Stroke, Color Overlay. */
function bakeOverStyles(L) {
  const st = L.styles, d = PS.doc, t = PS.tmpACtx, b = PS.tmpBCtx, c = PS.tmpCCtx;
  const ov = st.overlay;
  if (ov && ov.on) {
    ctxReset(b);
    b.clearRect(0, 0, d.width, d.height);
    b.drawImage(PS.tmpA, 0, 0);
    b.globalCompositeOperation = 'source-in';
    b.fillStyle = ov.color;
    b.fillRect(0, 0, d.width, d.height);
    ctxReset(b);
    t.globalAlpha = ov.opacity / 100;
    t.drawImage(PS.tmpB, 0, 0);
    t.globalAlpha = 1;
  }
  const is = st.innerShadow;
  if (is && is.on) {
    ctxReset(b);
    b.clearRect(0, 0, d.width, d.height);
    b.fillStyle = is.color;
    b.fillRect(0, 0, d.width, d.height);
    b.globalCompositeOperation = 'destination-out';
    b.drawImage(PS.tmpA, 0, 0);
    ctxReset(b);
    ctxReset(c);
    c.clearRect(0, 0, d.width, d.height);
    if (is.size > 0) c.filter = `blur(${is.size / 2}px)`;
    const rad = is.angle * Math.PI / 180;
    c.drawImage(PS.tmpB, -Math.cos(rad) * is.dist, Math.sin(rad) * is.dist);
    c.filter = 'none';
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(PS.tmpA, 0, 0);
    ctxReset(c);
    t.globalAlpha = is.opacity / 100;
    t.drawImage(PS.tmpC, 0, 0);
    t.globalAlpha = 1;
  }
  const str = st.stroke;
  if (str && str.on && str.size > 0) {
    ctxReset(b);
    b.clearRect(0, 0, d.width, d.height);
    const r = str.size, n = 16;
    for (let i = 0; i < n; i++) {
      const a = i / n * 2 * Math.PI;
      b.drawImage(PS.tmpA, Math.cos(a) * r, Math.sin(a) * r);
    }
    b.globalCompositeOperation = 'source-in';
    b.fillStyle = str.color;
    b.fillRect(0, 0, d.width, d.height);
    b.globalCompositeOperation = 'destination-out';
    b.drawImage(PS.tmpA, 0, 0);
    ctxReset(b);
    t.globalAlpha = (str.opacity == null ? 100 : str.opacity) / 100;
    t.drawImage(PS.tmpB, 0, 0);
    t.globalAlpha = 1;
  }
}

/* Per-pixel compositing for the eleven blend modes Canvas2D lacks.
   Source is the layer surface in tmpA; destination is ctx's canvas.
   Standard Porter–Duff with the blend function B(cb,cs). */
function blendManualOnto(ctx, mode, opacity) {
  const d = PS.doc, w = d.width, h = d.height;
  const dstImg = ctx.getImageData(0, 0, w, h);
  const srcImg = PS.tmpACtx.getImageData(0, 0, w, h);
  const D = dstImg.data, S = srcImg.data;
  const mi = MANUAL_BLENDS.indexOf(mode);
  const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;
  for (let i = 0; i < D.length; i += 4) {
    const as = (S[i + 3] / 255) * opacity;
    if (as === 0) continue;
    if (mi === 0) {                       // dissolve: stochastic threshold
      const p = i >> 2, x = p % w, y = (p / w) | 0;
      let hsh = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      hsh = (hsh * 2654435761) >>> 0;
      if (hsh / 4294967295 < as) {
        D[i] = S[i]; D[i + 1] = S[i + 1]; D[i + 2] = S[i + 2]; D[i + 3] = 255;
      }
      continue;
    }
    const ab = D[i + 3] / 255;
    const ao = as + ab * (1 - as);
    let pickSrc = false, wholePick = false;
    if (mi === 2 || mi === 4) {           // darker/lighter color: whole pixel
      wholePick = true;
      const ls = lum(S[i], S[i + 1], S[i + 2]), lb = lum(D[i], D[i + 1], D[i + 2]);
      pickSrc = mi === 2 ? ls < lb : ls > lb;
    }
    for (let ch = 0; ch < 3; ch++) {
      const cb = D[i + ch] / 255, cs = S[i + ch] / 255;
      let bl;
      if (wholePick) bl = pickSrc ? cs : cb;
      else switch (mi) {
        case 1: bl = cb + cs - 1; break;                                  // linear burn
        case 3: bl = cb + cs; break;                                      // linear dodge
        case 5:                                                           // vivid light
          bl = cs <= 0.5
            ? (cs <= 0 ? 0 : 1 - Math.min(1, (1 - cb) / (2 * cs)))
            : (cs >= 1 ? 1 : Math.min(1, cb / (2 * (1 - cs))));
          break;
        case 6: bl = cb + 2 * cs - 1; break;                              // linear light
        case 7: bl = cs < 0.5 ? Math.min(cb, 2 * cs) : Math.max(cb, 2 * cs - 1); break;
        case 8: bl = cb + cs >= 1 ? 1 : 0; break;                         // hard mix
        case 9: bl = cb - cs; break;                                      // subtract
        default: bl = cs <= 0 ? 1 : Math.min(1, cb / cs); break;          // divide
      }
      bl = clamp(bl, 0, 1);
      const co = (as * (1 - ab) * cs + ab * (1 - as) * cb + as * ab * bl) / (ao || 1);
      D[i + ch] = co * 255;
    }
    D[i + 3] = ao * 255;
  }
  ctx.putImageData(dstImg, 0, 0);
}

/* ---------- selection ----------
   Stored as polygon point-arrays + fill rule, realized as a Path2D
   (for marching ants) and a raster mask (for painting, fills and
   filters — the mask may be soft/feathered or come from the wand). */

function buildSelection(ptsArrays, fillRule) {
  const path = new Path2D();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pts of ptsArrays) {
    if (pts.length < 3) continue;
    path.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
    path.closePath();
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const d = PS.doc;
  const bounds = {
    x: clamp(Math.floor(minX), 0, d.width),
    y: clamp(Math.floor(minY), 0, d.height),
  };
  bounds.w = clamp(Math.ceil(maxX), 0, d.width) - bounds.x;
  bounds.h = clamp(Math.ceil(maxY), 0, d.height) - bounds.y;
  return { pts: ptsArrays, fillRule, path, bounds, mask: null };
}

function setSelection(ptsArrays, fillRule = 'nonzero') {
  const sel = buildSelection(ptsArrays, fillRule);
  if (sel.bounds.w < 1 || sel.bounds.h < 1) { clearSelection(); return; }
  PS.doc.selection = sel;
  requestRender();
}

function clearSelection() {
  if (PS.doc) PS.doc.selection = null;
  requestRender();
}

function rectPts(x, y, w, h) {
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

function ellipsePts(cx, cy, rx, ry) {
  const n = clamp(Math.round(Math.max(rx, ry) * 0.8), 24, 180);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * 2 * Math.PI;
    pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return pts;
}

function selectAll() {
  const d = PS.doc;
  setSelection([rectPts(0, 0, d.width, d.height)]);
}

function invertSelection() {
  const d = PS.doc;
  if (!d.selection) return;
  const inv = mkCanvas(d.width, d.height);
  const c = ctx2d(inv);
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, d.width, d.height);
  c.globalCompositeOperation = 'destination-out';
  c.drawImage(selectionMask(d.selection), 0, 0);
  setSelectionFromMask(inv);
}

/* Raster mask of the selection (doc-sized, alpha inside). May have been
   assigned directly (wand / feather); otherwise built from the path. */
function selectionMask(sel) {
  if (!sel.mask) {
    const d = PS.doc;
    sel.mask = mkCanvas(d.width, d.height);
    const c = ctx2d(sel.mask);
    c.fillStyle = '#ffffff';
    c.fill(sel.path, sel.fillRule);
  }
  return sel.mask;
}

/* Trace the ≥50% contour of a raster mask into polygon loops (pixel-edge
   following: every boundary edge is emitted once with the inside kept on
   a consistent side, so loops close and holes wind oppositely). */
function traceMaskToPts(data, w, h, thresh = 128) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] >= thresh;
  const stride = w + 1;
  const edges = new Map();
  const addE = (a, b) => {
    let arr = edges.get(a);
    if (!arr) { arr = []; edges.set(a, arr); }
    arr.push(b);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) addE(y * stride + x, y * stride + x + 1);
      if (!inside(x + 1, y)) addE(y * stride + x + 1, (y + 1) * stride + x + 1);
      if (!inside(x, y + 1)) addE((y + 1) * stride + x + 1, (y + 1) * stride + x);
      if (!inside(x - 1, y)) addE((y + 1) * stride + x, y * stride + x);
    }
  }
  const paths = [];
  for (const [start] of edges) {
    for (;;) {
      const firstArr = edges.get(start);
      if (!firstArr || firstArr.length === 0) break;
      const raw = [];
      let k = start;
      do {
        const arr = edges.get(k);
        raw.push(k);
        k = arr.pop();
      } while (k !== start && raw.length <= (w + 1) * (h + 1) * 2);
      const out = [];
      for (const v of raw) {
        const x = v % stride, y = (v / stride) | 0;
        const n = out.length;
        if (n >= 2) {
          const a = out[n - 2], b = out[n - 1];
          if ((b.x - a.x) * (y - b.y) === (x - b.x) * (b.y - a.y)) {
            out[n - 1] = { x, y };
            continue;
          }
        }
        out.push({ x, y });
      }
      if (out.length >= 3) paths.push(out);
    }
  }
  return paths;
}

/* Make maskCanvas (doc-sized, alpha = selectedness) the selection.
   Keeps the canvas as the raster mask so soft edges survive. */
function setSelectionFromMask(maskCanvas, softBounds) {
  const d = PS.doc;
  const data = ctx2d(maskCanvas).getImageData(0, 0, d.width, d.height).data;
  const paths = traceMaskToPts(data, d.width, d.height);
  if (!paths.length) { clearSelection(); return; }
  const sel = buildSelection(paths, 'nonzero');
  sel.mask = maskCanvas;
  if (softBounds) sel.bounds = softBounds;
  d.selection = sel;
  requestRender();
}

function featherSelection(radius) {
  const d = PS.doc, sel = d.selection;
  if (!sel || radius <= 0) return;
  const soft = mkCanvas(d.width, d.height);
  const c = ctx2d(soft);
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, d.width, d.height);
  c.globalCompositeOperation = 'destination-in';
  c.drawImage(selectionMask(sel), 0, 0);
  c.globalCompositeOperation = 'source-over';
  const img = c.getImageData(0, 0, d.width, d.height);
  gaussianBlur(img.data, d.width, d.height, radius);
  c.putImageData(img, 0, 0);
  const b = sel.bounds, m = Math.ceil(radius * 2);
  const nb = { x: clamp(b.x - m, 0, d.width), y: clamp(b.y - m, 0, d.height) };
  nb.w = clamp(b.x + b.w + m, 0, d.width) - nb.x;
  nb.h = clamp(b.y + b.h + m, 0, d.height) - nb.y;
  setSelectionFromMask(soft, nb);
}

/* Stroke buffer masked by the current selection, into tmpB. */
function maskedStrokeBuffer(strokeCanvas) {
  const d = PS.doc, b = PS.tmpBCtx;
  ctxReset(b);
  b.clearRect(0, 0, d.width, d.height);
  b.drawImage(strokeCanvas, 0, 0);
  if (d.selection) {
    b.globalCompositeOperation = 'destination-in';
    b.drawImage(selectionMask(d.selection), 0, 0);
    b.globalCompositeOperation = 'source-over';
  }
  return PS.tmpB;
}

/* ---------- history ----------
   Command entries with undo/redo closures. Pixel edits snapshot only the
   touched layer (Photoshop snapshots only touched tiles — same idea,
   coarser grain). Capped to bound memory. */

const History = {
  undoStack: [],
  redoStack: [],
  limit: 30,
  onChange: null,

  reset() {
    this.undoStack = [{ name: 'Open', undo() {}, redo() {} }];
    this.redoStack = [];
    this.notify();
  },

  push(entry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.notify();
  },

  /* target: 'canvas' (default) or 'mask' */
  pushPixel(name, layer, beforeCanvas, target = 'canvas') {
    const after = cloneCanvas(target === 'mask' ? layer.mask : layer.canvas);
    const before = beforeCanvas;
    const assign = (src) => {
      if (target === 'mask') layer.mask = cloneCanvas(src);
      else layer.canvas = cloneCanvas(src);
    };
    this.push({
      name,
      undo() { assign(before); },
      redo() { assign(after); },
    });
  },

  undo() {
    if (this.undoStack.length <= 1) return;
    const e = this.undoStack.pop();
    e.undo();
    this.redoStack.push(e);
    this.afterMove();
  },

  redo() {
    const e = this.redoStack.pop();
    if (!e) return;
    e.redo();
    this.undoStack.push(e);
    this.afterMove();
  },

  /* Jump so that undoStack has (index+1) entries. */
  jumpTo(index) {
    while (this.undoStack.length - 1 > index && this.undoStack.length > 1) {
      const e = this.undoStack.pop();
      e.undo();
      this.redoStack.push(e);
    }
    while (this.undoStack.length - 1 < index && this.redoStack.length > 0) {
      const e = this.redoStack.pop();
      e.redo();
      this.undoStack.push(e);
    }
    this.afterMove();
  },

  afterMove() {
    const d = PS.doc;
    if (d) d.activeIndex = clamp(d.activeIndex, 0, d.layers.length - 1);
    requestRender();
    this.notify();
  },

  notify() { if (this.onChange) this.onChange(); },
};

/* ---------- layer operations (all history-recorded) ---------- */

function addLayer(name) {
  const d = PS.doc;
  const layer = createLayer(name || 'Layer ' + (PS.layerSeq + 1), d.width, d.height, null);
  const index = d.activeIndex + 1;
  d.layers.splice(index, 0, layer);
  d.activeIndex = index;
  History.push({
    name: 'New layer',
    undo() { d.layers.splice(index, 1); },
    redo() { d.layers.splice(index, 0, layer); },
  });
  requestRender();
  return layer;
}

function addLayerWithContent(name, drawFn) {
  const d = PS.doc;
  const layer = createLayer(name, d.width, d.height, null);
  drawFn(layer.canvas.getContext('2d'), layer);
  const index = d.activeIndex + 1;
  d.layers.splice(index, 0, layer);
  d.activeIndex = index;
  History.push({
    name,
    undo() { d.layers.splice(index, 1); },
    redo() { d.layers.splice(index, 0, layer); },
  });
  requestRender();
  return layer;
}

function duplicateLayer() {
  const d = PS.doc;
  const src = activeLayer();
  const copy = {
    ...src,
    id: ++PS.layerSeq,
    name: src.name + ' copy',
    canvas: src.canvas ? cloneCanvas(src.canvas) : null,
    mask: src.mask ? cloneCanvas(src.mask) : null,
    styles: src.styles ? JSON.parse(JSON.stringify(src.styles)) : null,
    adjustment: isAdjustmentLayer(src) ? { type: src.adjustment.type, params: structuredClone(src.adjustment.params) } : null,
    targetMask: false,
  };
  const index = d.activeIndex + 1;
  d.layers.splice(index, 0, copy);
  d.activeIndex = index;
  History.push({
    name: 'Duplicate layer',
    undo() { d.layers.splice(index, 1); },
    redo() { d.layers.splice(index, 0, copy); },
  });
  requestRender();
}

function deleteLayer() {
  const d = PS.doc;
  if (d.layers.length <= 1) return;
  const index = d.activeIndex;
  const layer = d.layers[index];
  d.layers.splice(index, 1);
  d.activeIndex = clamp(index - 1, 0, d.layers.length - 1);
  History.push({
    name: 'Delete layer',
    undo() { d.layers.splice(index, 0, layer); },
    redo() { d.layers.splice(index, 1); },
  });
  requestRender();
}

function moveLayer(delta) {
  const d = PS.doc;
  const from = d.activeIndex, to = from + delta;
  if (to < 0 || to >= d.layers.length) return;
  const [layer] = d.layers.splice(from, 1);
  d.layers.splice(to, 0, layer);
  d.activeIndex = to;
  History.push({
    name: delta > 0 ? 'Raise layer' : 'Lower layer',
    undo() { d.layers.splice(to, 1); d.layers.splice(from, 0, layer); },
    redo() { d.layers.splice(from, 1); d.layers.splice(to, 0, layer); },
  });
  requestRender();
}

function mergeDown() {
  const d = PS.doc;
  const i = d.activeIndex;
  if (i <= 0) return;
  const top = d.layers[i], bottom = d.layers[i - 1];
  const beforeBottom = {
    canvas: bottom.canvas, x: bottom.x, y: bottom.y,
    mask: bottom.mask, styles: bottom.styles, adjustment: bottom.adjustment,
  };
  const merged = mkCanvas(d.width, d.height);
  const c = merged.getContext('2d');
  compositeLayerOnto(c, bottom, false);
  compositeLayerOnto(c, top, false);
  const applyMerged = () => {
    bottom.canvas = merged;
    bottom.x = 0; bottom.y = 0;
    bottom.mask = null; bottom.styles = null; bottom.adjustment = null;
    bottom.targetMask = false;
  };
  applyMerged();
  d.layers.splice(i, 1);
  d.activeIndex = i - 1;
  History.push({
    name: 'Merge down',
    undo() {
      bottom.canvas = beforeBottom.canvas;
      bottom.x = beforeBottom.x; bottom.y = beforeBottom.y;
      bottom.mask = beforeBottom.mask; bottom.styles = beforeBottom.styles;
      bottom.adjustment = beforeBottom.adjustment;
      d.layers.splice(i, 0, top);
    },
    redo() {
      applyMerged();
      d.layers.splice(i, 1);
    },
  });
  requestRender();
}

function flattenImage() {
  const d = PS.doc;
  compositeDoc();
  const flatLayer = createLayer('Background', d.width, d.height, '#ffffff');
  flatLayer.canvas.getContext('2d').drawImage(PS.flat, 0, 0);
  const before = d.layers.slice();
  const beforeActive = d.activeIndex;
  d.layers = [flatLayer];
  d.activeIndex = 0;
  History.push({
    name: 'Flatten image',
    undo() { d.layers = before.slice(); d.activeIndex = beforeActive; },
    redo() { d.layers = [flatLayer]; d.activeIndex = 0; },
  });
  requestRender();
}

function setLayerProps(layer, props, historyName) {
  const before = {};
  for (const k of Object.keys(props)) before[k] = layer[k];
  Object.assign(layer, props);
  History.push({
    name: historyName,
    undo() { Object.assign(layer, before); },
    redo() { Object.assign(layer, props); },
  });
  requestRender();
}

function setLayerStyles(layer, styles) {
  const before = layer.styles;
  layer.styles = styles;
  History.push({
    name: 'Layer style',
    undo() { layer.styles = before; requestRender(); },
    redo() { layer.styles = styles; requestRender(); },
  });
  requestRender();
}

/* ---------- layer masks ---------- */

function addLayerMask(kind) {           // 'reveal' | 'hide' | 'selection'
  const L = activeLayer();
  if (!L || L.mask) return;
  const d = PS.doc;
  const mask = mkCanvas(L.canvas ? L.canvas.width : d.width, L.canvas ? L.canvas.height : d.height);
  const mc = mask.getContext('2d');
  if (kind === 'selection' && d.selection) {
    mc.translate(-L.x, -L.y);
    mc.drawImage(selectionMask(d.selection), 0, 0);
  } else if (kind !== 'hide') {
    mc.fillStyle = '#000000';
    mc.fillRect(0, 0, mask.width, mask.height);
  }
  L.mask = mask;
  L.targetMask = true;
  History.push({
    name: 'Add layer mask',
    undo() { L.mask = null; L.targetMask = false; requestRender(); },
    redo() { L.mask = mask; L.targetMask = true; requestRender(); },
  });
  requestRender();
}

function removeLayerMask(apply) {
  const L = activeLayer();
  if (!L || !L.mask) return;
  apply = apply && !isAdjustmentLayer(L); // nothing to bake a mask into on an adjustment layer
  const mask = L.mask;
  const beforeCanvas = apply ? cloneCanvas(L.canvas) : null;
  if (apply) {
    const c = L.canvas.getContext('2d');
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(mask, 0, 0);
    c.globalCompositeOperation = 'source-over';
  }
  const afterCanvas = apply ? cloneCanvas(L.canvas) : null;
  L.mask = null;
  L.targetMask = false;
  History.push({
    name: apply ? 'Apply layer mask' : 'Delete layer mask',
    undo() {
      L.mask = mask;
      if (apply) L.canvas = cloneCanvas(beforeCanvas);
      requestRender();
    },
    redo() {
      L.mask = null;
      L.targetMask = false;
      if (apply) L.canvas = cloneCanvas(afterCanvas);
      requestRender();
    },
  });
  requestRender();
}

/* ---------- document geometry ---------- */

function resizeDocument(scalePct) {
  const d = PS.doc;
  const f = scalePct / 100;
  const nw = clamp(Math.round(d.width * f), 1, 8192);
  const nh = clamp(Math.round(d.height * f), 1, 8192);
  const before = d.layers.map(L => ({ L, canvas: L.canvas, mask: L.mask, x: L.x, y: L.y }));
  const ow = d.width, oh = d.height;
  const scaleCanvas = (src) => {
    const c = mkCanvas(Math.max(1, Math.round(src.width * f)),
                       Math.max(1, Math.round(src.height * f)));
    const cc = c.getContext('2d');
    cc.imageSmoothingQuality = 'high';
    cc.drawImage(src, 0, 0, c.width, c.height);
    return c;
  };
  const apply = () => {
    for (const s of before) {
      s.L.canvas = s.canvas ? scaleCanvas(s.canvas) : null;
      s.L.mask = s.mask ? scaleCanvas(s.mask) : null;
      s.L.x = Math.round(s.x * f);
      s.L.y = Math.round(s.y * f);
    }
    d.width = nw; d.height = nh;
    d.selection = null;
    reallocBuffers();
  };
  apply();
  History.push({
    name: 'Image size',
    undo() {
      for (const s of before) { s.L.canvas = s.canvas; s.L.mask = s.mask; s.L.x = s.x; s.L.y = s.y; }
      d.width = ow; d.height = oh;
      d.selection = null;
      reallocBuffers();
    },
    redo: apply,
  });
  requestRender();
}

function cropDocument(x, y, w, h) {
  const d = PS.doc;
  x = Math.round(x); y = Math.round(y);
  w = clamp(Math.round(w), 1, 8192);
  h = clamp(Math.round(h), 1, 8192);
  const ow = d.width, oh = d.height;
  const offs = d.layers.map(L => ({ L, x: L.x, y: L.y }));
  const apply = () => {
    d.width = w; d.height = h;
    for (const o of offs) { o.L.x = o.x - x; o.L.y = o.y - y; }
    d.selection = null;
    reallocBuffers();
    requestRender();
  };
  apply();
  History.push({
    name: 'Crop',
    undo() {
      d.width = ow; d.height = oh;
      for (const o of offs) { o.L.x = o.x; o.L.y = o.y; }
      d.selection = null;
      reallocBuffers();
      requestRender();
    },
    redo: apply,
  });
}

/* fx, fy in {0, 0.5, 1}: where the old canvas sits inside the new one. */
function canvasSizeDocument(nw, nh, fx, fy) {
  const d = PS.doc;
  nw = clamp(Math.round(nw), 1, 8192);
  nh = clamp(Math.round(nh), 1, 8192);
  const dx = Math.round((nw - d.width) * fx), dy = Math.round((nh - d.height) * fy);
  const ow = d.width, oh = d.height;
  const offs = d.layers.map(L => ({ L, x: L.x, y: L.y }));
  const apply = () => {
    d.width = nw; d.height = nh;
    for (const o of offs) { o.L.x = o.x + dx; o.L.y = o.y + dy; }
    d.selection = null;
    reallocBuffers();
    requestRender();
  };
  apply();
  History.push({
    name: 'Canvas size',
    undo() {
      d.width = ow; d.height = oh;
      for (const o of offs) { o.L.x = o.x; o.L.y = o.y; }
      d.selection = null;
      reallocBuffers();
      requestRender();
    },
    redo: apply,
  });
}

function remakeRotated(src, kind) {
  let nc;
  const w = src.width, h = src.height;
  if (kind === 'rot90' || kind === 'rot-90') nc = mkCanvas(h, w);
  else nc = mkCanvas(w, h);
  const c = nc.getContext('2d');
  if (kind === 'rot90') { c.translate(h, 0); c.rotate(Math.PI / 2); }
  else if (kind === 'rot-90') { c.translate(0, w); c.rotate(-Math.PI / 2); }
  else if (kind === 'rot180') { c.translate(w, h); c.rotate(Math.PI); }
  else if (kind === 'flipH') { c.translate(w, 0); c.scale(-1, 1); }
  else { c.translate(0, h); c.scale(1, -1); }
  c.drawImage(src, 0, 0);
  return nc;
}

const CANVAS_ROT_NAMES = {
  rot90: 'Rotate canvas 90° CW', 'rot-90': 'Rotate canvas 90° CCW',
  rot180: 'Rotate canvas 180°', flipH: 'Flip canvas horizontal', flipV: 'Flip canvas vertical',
};

function rotateCanvasDoc(kind) {
  const d = PS.doc;
  const ow = d.width, oh = d.height;
  const swap = kind === 'rot90' || kind === 'rot-90';
  const nw = swap ? oh : ow, nh = swap ? ow : oh;
  const items = d.layers.map(L => {
    const w = L.canvas ? L.canvas.width : ow, h = L.canvas ? L.canvas.height : oh;
    let nx, ny;
    if (kind === 'rot90') { nx = oh - (L.y + h); ny = L.x; }
    else if (kind === 'rot-90') { nx = L.y; ny = ow - (L.x + w); }
    else if (kind === 'rot180') { nx = ow - (L.x + w); ny = oh - (L.y + h); }
    else if (kind === 'flipH') { nx = ow - (L.x + w); ny = L.y; }
    else { nx = L.x; ny = oh - (L.y + h); }
    return {
      L,
      before: { canvas: L.canvas, mask: L.mask, x: L.x, y: L.y },
      after: {
        canvas: L.canvas ? remakeRotated(L.canvas, kind) : null,
        mask: L.mask ? remakeRotated(L.mask, kind) : null,
        x: isAdjustmentLayer(L) ? 0 : nx, y: isAdjustmentLayer(L) ? 0 : ny,
      },
    };
  });
  const set = (which, wD, hD) => {
    for (const it of items) {
      const s = it[which];
      it.L.canvas = s.canvas; it.L.mask = s.mask; it.L.x = s.x; it.L.y = s.y;
    }
    d.width = wD; d.height = hD;
    d.selection = null;
    reallocBuffers();
    requestRender();
  };
  set('after', nw, nh);
  History.push({
    name: CANVAS_ROT_NAMES[kind],
    undo() { set('before', ow, oh); },
    redo() { set('after', nw, nh); },
  });
}

/* ---------- align to canvas ----------
   Matches Photoshop's Move-tool "align to canvas" behavior (what its
   option-bar align buttons do when only one layer is selected): snap the
   active layer's bounding box to a canvas edge or center. Always relative
   to the document, not to a selection or other layers. */
const ALIGN_NAMES = {
  left: 'Align left', 'h-center': 'Align center', right: 'Align right',
  top: 'Align top', 'v-center': 'Align middle', bottom: 'Align bottom',
};

/* Bounding box of "content" pixels (as decided by isContent(i), i = pixel
   index, row-major) built from row/column projection counts rather than
   a strict min/max over every matching pixel. A strict min/max is not
   robust: a single stray mark far from the real subject — a watermark, a
   scanner speck, a JPEG-artifact pixel, the odd non-transparent pixel
   left over from a sloppy export — silently drags the whole bounding box
   out to meet it, which is exactly the "still wrong" case where the
   subject visibly isn't centered on where align/snap put it. Requiring a
   row (or column) to contain more than a small fraction of matching
   pixels before it counts filters that out, since a real subject's
   stroke/fill width spans far more of a row than a few stray marks ever
   would; only if every row/column is that sparse (e.g. a hairline
   diagonal) does this fall back to the strict any-pixel box. O(w·h); only
   called once per align click or once per drag start, never per frame. */
function boundsFromContentPredicate(w, h, isContent) {
  const rowCounts = new Uint32Array(h), colCounts = new Uint32Array(w);
  let any = false;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (isContent(row + x)) { rowCounts[y]++; colCounts[x]++; any = true; }
    }
  }
  if (!any) return null;
  const extent = (counts, n, thresh) => {
    let min = -1, max = -1;
    for (let i = 0; i < n; i++) {
      if (counts[i] > thresh) { if (min < 0) min = i; max = i; }
    }
    return { min, max };
  };
  let ex = extent(colCounts, w, Math.max(2, Math.round(h * 0.002)));
  let ey = extent(rowCounts, h, Math.max(2, Math.round(w * 0.002)));
  if (ex.min < 0 || ey.min < 0) { // everything was sparse — fall back to strict any-pixel bounds
    ex = extent(colCounts, w, 0);
    ey = extent(rowCounts, h, 0);
  }
  return { x: ex.min, y: ey.min, w: ex.max - ex.min + 1, h: ey.max - ey.min + 1 };
}

/* Bounding box of pixels that differ from a uniform border color (sampled
   from the four corners, which must agree within `tol` per channel for
   this to apply at all) — the same idea as Photoshop's Image > Trim
   using a corner color. This is the fallback for a fully opaque canvas
   (a flattened photo, a JPEG import, anything with no real alpha
   transparency) where getOpaqueBounds' alpha scan can't tell content
   from background because everything is 100% opaque. Returns null when
   the corners disagree (no single background color) or the whole canvas
   is that one uniform color (nothing to trim). */
function getTrimmedBounds(data, w, h, tol = 12) {
  const close = (i, j) => Math.abs(data[i] - data[j]) <= tol && Math.abs(data[i + 1] - data[j + 1]) <= tol && Math.abs(data[i + 2] - data[j + 2]) <= tol;
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + (w - 1)) * 4];
  for (let k = 1; k < corners.length; k++) if (!close(corners[0], corners[k])) return null;
  const bg = corners[0];
  return boundsFromContentPredicate(w, h, (i) => !close(i * 4, bg));
}

/* The bounding box of a canvas's actual visible content, in that canvas's
   own local coordinates — what alignLayer() and the Move tool's smart-
   guide snapping both align/snap against, instead of the raw canvas
   rect. A layer's canvas is often padded with transparent margin (an
   imported image that wasn't cropped tight, a layer bigger than its
   content, ...), and aligning the raw rect against that margin looks
   lopsided; a fully opaque canvas (a flattened photo, a JPEG import) has
   the same problem from the opposite direction — nothing is transparent,
   so the alpha channel can't tell content from background at all. Falls
   back to the full canvas when there's no non-transparent pixel (a blank
   layer) or no way to trim an opaque one (no single uniform border
   color) — nothing to trim to either way. */
function getOpaqueBounds(canvas) {
  const w = canvas.width, h = canvas.height;
  const data = ctx2d(canvas).getImageData(0, 0, w, h).data;
  let anyTransparent = false;
  for (let i = 3; i < data.length; i += 4) if (data[i] === 0) { anyTransparent = true; break; }
  if (!anyTransparent) {
    return getTrimmedBounds(data, w, h) || { x: 0, y: 0, w, h };
  }
  return boundsFromContentPredicate(w, h, (i) => data[i * 4 + 3] !== 0) || { x: 0, y: 0, w, h };
}

function alignLayer(kind) {
  const L = activeLayer();
  if (!L || isAdjustmentLayer(L)) return;
  const d = PS.doc;
  const b = getOpaqueBounds(L.canvas);
  const contentX = L.x + b.x, contentY = L.y + b.y;
  let targetX = contentX, targetY = contentY;
  if (kind === 'left') targetX = 0;
  else if (kind === 'h-center') targetX = Math.round((d.width - b.w) / 2);
  else if (kind === 'right') targetX = d.width - b.w;
  else if (kind === 'top') targetY = 0;
  else if (kind === 'v-center') targetY = Math.round((d.height - b.h) / 2);
  else if (kind === 'bottom') targetY = d.height - b.h;
  const dx = targetX - contentX, dy = targetY - contentY;
  if (dx === 0 && dy === 0) return;
  const before = { x: L.x, y: L.y };
  const after = { x: L.x + dx, y: L.y + dy };
  L.x = after.x; L.y = after.y;
  History.push({
    name: ALIGN_NAMES[kind] || 'Align layer',
    undo() { L.x = before.x; L.y = before.y; requestRender(); },
    redo() { L.x = after.x; L.y = after.y; requestRender(); },
  });
  requestRender();
}

const LAYER_ROT_NAMES = {
  rot90: 'Rotate layer 90° CW', 'rot-90': 'Rotate layer 90° CCW',
  rot180: 'Rotate layer 180°', flipH: 'Flip layer horizontal', flipV: 'Flip layer vertical',
};

function transformActiveLayer(kind) {
  const L = activeLayer();
  if (!L || PS.transform || isAdjustmentLayer(L)) return;
  const nc = remakeRotated(L.canvas, kind);
  const nm = L.mask ? remakeRotated(L.mask, kind) : null;
  const cx = L.x + L.canvas.width / 2, cy = L.y + L.canvas.height / 2;
  const before = { canvas: L.canvas, mask: L.mask, x: L.x, y: L.y };
  const after = { canvas: nc, mask: nm, x: Math.round(cx - nc.width / 2), y: Math.round(cy - nc.height / 2) };
  const set = (s) => { L.canvas = s.canvas; L.mask = s.mask; L.x = s.x; L.y = s.y; requestRender(); };
  set(after);
  History.push({
    name: LAYER_ROT_NAMES[kind],
    undo() { set(before); },
    redo() { set(after); },
  });
}

/* ---------- free transform ---------- */

function applyTransformCtx(c, tr) {
  c.translate(tr.cx + tr.tx, tr.cy + tr.ty);
  c.rotate(tr.rot);
  c.scale(tr.sx, tr.sy);
  c.translate(-tr.cx, -tr.cy);
}

function transformPoint(tr, x, y) {
  const vx = (x - tr.cx) * tr.sx, vy = (y - tr.cy) * tr.sy;
  const cs = Math.cos(tr.rot), sn = Math.sin(tr.rot);
  return { x: vx * cs - vy * sn + tr.cx + tr.tx, y: vx * sn + vy * cs + tr.cy + tr.ty };
}

function beginFreeTransform() {
  const L = activeLayer();
  if (!L || !PS.doc || PS.transform || isAdjustmentLayer(L)) return;
  PS.transform = {
    layer: L, orig: L.canvas, origMask: L.mask,
    ox: L.x, oy: L.y,
    cx: L.x + L.canvas.width / 2, cy: L.y + L.canvas.height / 2,
    sx: 1, sy: 1, rot: 0, tx: 0, ty: 0,
  };
  requestRender();
}

function cancelFreeTransform() {
  PS.transform = null;
  requestRender();
}

function commitFreeTransform() {
  const tr = PS.transform;
  if (!tr) return;
  PS.transform = null;
  const L = tr.layer;
  if (tr.sx === 1 && tr.sy === 1 && tr.rot === 0 && tr.tx === 0 && tr.ty === 0) {
    requestRender();
    return;
  }
  const w0 = tr.orig.width, h0 = tr.orig.height;
  const corners = [[tr.ox, tr.oy], [tr.ox + w0, tr.oy], [tr.ox, tr.oy + h0], [tr.ox + w0, tr.oy + h0]]
    .map(p => transformPoint(tr, p[0], p[1]));
  const minX = Math.floor(Math.min(...corners.map(p => p.x)));
  const minY = Math.floor(Math.min(...corners.map(p => p.y)));
  const maxX = Math.ceil(Math.max(...corners.map(p => p.x)));
  const maxY = Math.ceil(Math.max(...corners.map(p => p.y)));
  const nw = clamp(maxX - minX, 1, 16384), nh = clamp(maxY - minY, 1, 16384);
  const render = (src) => {
    const nc = mkCanvas(nw, nh);
    const c = nc.getContext('2d');
    c.imageSmoothingQuality = 'high';
    c.translate(-minX, -minY);
    applyTransformCtx(c, tr);
    c.drawImage(src, tr.ox, tr.oy);
    return nc;
  };
  const before = { canvas: tr.orig, mask: tr.origMask, x: tr.ox, y: tr.oy };
  const after = { canvas: render(tr.orig), mask: tr.origMask ? render(tr.origMask) : null, x: minX, y: minY };
  const set = (s) => {
    L.canvas = cloneCanvas(s.canvas);
    L.mask = s.mask ? cloneCanvas(s.mask) : null;
    L.x = s.x; L.y = s.y;
    requestRender();
  };
  set(after);
  History.push({
    name: 'Free transform',
    undo() { set(before); },
    redo() { set(after); },
  });
}

/* ---------- edit ops ---------- */

function fillWithColor(color, opacity = 1) {
  const L = activeLayer();
  if (!L || isAdjustmentLayer(L)) return;
  const d = PS.doc;
  const before = cloneCanvas(L.canvas);
  const c = L.canvas.getContext('2d');
  c.save();
  c.globalAlpha = opacity;
  if (d.selection) {
    const b = PS.tmpBCtx;
    ctxReset(b);
    b.clearRect(0, 0, d.width, d.height);
    b.drawImage(selectionMask(d.selection), 0, 0);
    b.globalCompositeOperation = 'source-in';
    b.fillStyle = color;
    b.fillRect(0, 0, d.width, d.height);
    ctxReset(b);
    c.drawImage(PS.tmpB, -L.x, -L.y);
  } else {
    c.fillStyle = color;
    c.fillRect(0, 0, L.canvas.width, L.canvas.height);
  }
  c.restore();
  History.pushPixel('Fill', L, before);
  requestRender();
}

function clearSelectedPixels() {
  const d = PS.doc;
  const L = activeLayer();
  if (!L || !d.selection || isAdjustmentLayer(L)) return;
  const before = cloneCanvas(L.canvas);
  const c = L.canvas.getContext('2d');
  c.globalCompositeOperation = 'destination-out';
  c.drawImage(selectionMask(d.selection), -L.x, -L.y);
  c.globalCompositeOperation = 'source-over';
  History.pushPixel('Clear', L, before);
  requestRender();
}

function strokeSelectionOutline(width, color) {
  const d = PS.doc, sel = d && d.selection, L = activeLayer();
  if (!L || !sel || isAdjustmentLayer(L)) return;
  const before = cloneCanvas(L.canvas);
  const c = L.canvas.getContext('2d');
  c.save();
  c.translate(-L.x, -L.y);
  c.strokeStyle = color;
  c.lineWidth = width;
  c.lineJoin = 'round';
  c.stroke(sel.path);
  c.restore();
  History.pushPixel('Stroke selection', L, before);
  requestRender();
}

function copySelection() {
  const d = PS.doc;
  const L = activeLayer();
  if (!L || isAdjustmentLayer(L)) return false;
  const sel = d.selection;
  const b = sel ? sel.bounds : { x: 0, y: 0, w: d.width, h: d.height };
  if (b.w < 1 || b.h < 1) return false;
  const staged = mkCanvas(d.width, d.height);
  const sc = staged.getContext('2d');
  sc.drawImage(L.canvas, L.x, L.y);
  if (sel) {
    sc.globalCompositeOperation = 'destination-in';
    sc.drawImage(selectionMask(sel), 0, 0);
  }
  const out = mkCanvas(b.w, b.h);
  out.getContext('2d').drawImage(staged, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
  PS.clipboard = { canvas: out, x: b.x, y: b.y };
  return true;
}

function cutSelection() {
  if (!copySelection()) return;
  if (PS.doc.selection) clearSelectedPixels();
}

function pasteClipboard() {
  const clip = PS.clipboard;
  if (!clip || !PS.doc) return;
  addLayerWithContent('Pasted layer', (c) => {
    c.drawImage(clip.canvas, clip.x, clip.y);
  });
}

/* ---------- strokes (brush / eraser / clone / dodge / burn / gradient /
   shape all share this) ----------
   Paint at full alpha into a doc-sized buffer; composite once at the
   stroke's opacity (and composite op) on release. When the active layer
   targets its mask, the committed stroke edits mask alpha instead. */

function beginStroke(mode, opacity, name, op) {
  const d = PS.doc;
  const L = activeLayer();
  if (!L) return null;
  const toMask = !!(L.mask && L.targetMask);
  if (isAdjustmentLayer(L) && !toMask) return null; // nothing to paint on but its mask
  const canvas = mkCanvas(d.width, d.height);
  const rgb = hexToRgb(PS.fg) || { r: 0, g: 0, b: 0 };
  PS.stroke = {
    mode, opacity, name,
    op: op || null,
    layer: L,
    canvas, ctx: ctx2d(canvas),
    toMask,
    maskLuma: mode === 'erase' ? 255 : Math.round(lumaOf(rgb.r, rgb.g, rgb.b)),
    before: toMask ? cloneCanvas(L.mask) : cloneCanvas(L.canvas),
  };
  return PS.stroke;
}

function commitStroke() {
  const s = PS.stroke;
  if (!s) return;
  PS.stroke = null;
  const L = s.layer;
  const buf = maskedStrokeBuffer(s.canvas);
  if (s.toMask) {
    const mctx = ctx2d(L.mask);
    const mw = L.mask.width, mh = L.mask.height;
    const mimg = mctx.getImageData(0, 0, mw, mh);
    const simg = PS.tmpBCtx.getImageData(L.x, L.y, mw, mh);
    const md = mimg.data, sd = simg.data;
    for (let i = 0; i < md.length; i += 4) {
      const a = (sd[i + 3] / 255) * s.opacity;
      if (a === 0) continue;
      md[i + 3] = md[i + 3] * (1 - a) + s.maskLuma * a;
      md[i] = md[i + 1] = md[i + 2] = 0;
    }
    mctx.putImageData(mimg, 0, 0);
    History.pushPixel(s.name, L, s.before, 'mask');
  } else {
    const c = L.canvas.getContext('2d');
    c.save();
    c.translate(-L.x, -L.y);
    c.globalAlpha = s.opacity;
    c.globalCompositeOperation = s.mode === 'erase' ? 'destination-out' : (s.op || 'source-over');
    c.drawImage(buf, 0, 0);
    c.restore();
    History.pushPixel(s.name, L, s.before);
  }
  requestRender();
}

function cancelStroke() {
  PS.stroke = null;
  requestRender();
}
