'use strict';
/* Emulsion tools. Each tool gets pointer events already converted to
   document coordinates. Strokes paint at full alpha into a doc-sized
   stroke buffer (masked by the selection at composite time) and are
   composited onto the layer once, at the stroke's opacity, on release —
   which is why overlapping stamps in one stroke don't build up, like
   Photoshop. */

function stampBrush(ctx, x, y, size, hardness, color) {
  const r = Math.max(0.5, size / 2);
  if (hardness >= 0.99) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const inner = Math.max(0, r * hardness);
    const g = ctx.createRadialGradient(x, y, inner, x, y, r);
    const rgb = hexToRgb(color) || { r: 0, g: 0, b: 0 };
    g.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},1)`);
    g.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function strokeSegment(ctx, from, to, size, hardness, color) {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const spacing = Math.max(size * 0.12, 0.75);
  const steps = Math.max(1, Math.ceil(dist / spacing));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    stampBrush(ctx, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t,
               size, hardness, color);
  }
}

function makePaintTool(mode, name) {
  return {
    name,
    cursor: 'none',
    onDown(p) {
      const o = PS.toolOpts;
      const s = beginStroke(mode, o.opacity, name);
      if (!s) return;
      s.last = p;
      stampBrush(s.ctx, p.x, p.y, o.size, o.hardness, mode === 'erase' ? '#000000' : PS.fg);
      requestRender();
    },
    onMove(p) {
      const s = PS.stroke;
      if (!s) return;
      const o = PS.toolOpts;
      strokeSegment(s.ctx, s.last, p, o.size, o.hardness, mode === 'erase' ? '#000000' : PS.fg);
      s.last = p;
      requestRender();
    },
    onUp() { commitStroke(); },
    options: ['size', 'hardness', 'opacity'],
  };
}

/* Dodge / Burn: painted as white / black through soft-light, at the
   exposure setting — the classic darkroom emulation. */
function makeToneTool(kind) {
  const name = kind === 'dodge' ? 'Dodge' : 'Burn';
  const color = kind === 'dodge' ? '#ffffff' : '#000000';
  return {
    name,
    cursor: 'none',
    onDown(p) {
      const o = PS.toolOpts;
      const s = beginStroke('paint', o.exposure, name, 'soft-light');
      if (!s) return;
      s.last = p;
      stampBrush(s.ctx, p.x, p.y, o.size, o.hardness, color);
      requestRender();
    },
    onMove(p) {
      const s = PS.stroke;
      if (!s) return;
      const o = PS.toolOpts;
      strokeSegment(s.ctx, s.last, p, o.size, o.hardness, color);
      s.last = p;
      requestRender();
    },
    onUp() { commitStroke(); },
    options: ['size', 'hardness', 'exposure'],
  };
}

function floodFill(p) {
  const d = PS.doc;
  const L = activeLayer();
  if (!L) return;
  const lx = Math.floor(p.x - L.x), ly = Math.floor(p.y - L.y);
  const w = L.canvas.width, h = L.canvas.height;
  if (lx < 0 || ly < 0 || lx >= w || ly >= h) return;
  const before = cloneCanvas(L.canvas);
  const c = ctx2d(L.canvas);
  const img = c.getImageData(0, 0, w, h);
  const px = img.data;
  let mask = null;
  if (d.selection) {
    mask = ctx2d(selectionMask(d.selection)).getImageData(0, 0, d.width, d.height).data;
    const mi = ((ly + L.y) * d.width + (lx + L.x)) * 4 + 3;
    if (mask[mi] < 128) return;   // seed outside selection
  }
  const inSel = (x, y) => {
    if (!mask) return true;
    const dx = x + L.x, dy = y + L.y;
    if (dx < 0 || dy < 0 || dx >= d.width || dy >= d.height) return false;
    return mask[(dy * d.width + dx) * 4 + 3] >= 128;
  };
  const si = (ly * w + lx) * 4;
  const sr = px[si], sg = px[si + 1], sb = px[si + 2], sa = px[si + 3];
  const tol = PS.toolOpts.tolerance;
  const fc = hexToRgb(PS.fg);
  if (sa > 0 && Math.abs(sr - fc.r) + Math.abs(sg - fc.g) + Math.abs(sb - fc.b) === 0 && sa === 255) return;
  const match = (i) =>
    Math.abs(px[i] - sr) <= tol && Math.abs(px[i + 1] - sg) <= tol &&
    Math.abs(px[i + 2] - sb) <= tol && Math.abs(px[i + 3] - sa) <= tol;
  const seen = new Uint8Array(w * h);
  const stack = [lx + ly * w];
  seen[lx + ly * w] = 1;
  while (stack.length) {
    const idx = stack.pop();
    const x = idx % w, y = (idx / w) | 0;
    const i = idx * 4;
    if (!match(i) || !inSel(x, y)) continue;
    px[i] = fc.r; px[i + 1] = fc.g; px[i + 2] = fc.b; px[i + 3] = 255;
    if (x > 0 && !seen[idx - 1]) { seen[idx - 1] = 1; stack.push(idx - 1); }
    if (x < w - 1 && !seen[idx + 1]) { seen[idx + 1] = 1; stack.push(idx + 1); }
    if (y > 0 && !seen[idx - w]) { seen[idx - w] = 1; stack.push(idx - w); }
    if (y < h - 1 && !seen[idx + w]) { seen[idx + w] = 1; stack.push(idx + w); }
  }
  c.putImageData(img, 0, 0);
  History.pushPixel('Fill (bucket)', L, before);
  requestRender();
}

/* Magic wand: tolerance match against the composite, contiguous or not,
   realized as a raster mask selection. */
function magicWandSelect(p) {
  const d = PS.doc;
  const x = Math.floor(p.x), y = Math.floor(p.y);
  if (x < 0 || y < 0 || x >= d.width || y >= d.height) return;
  compositeDoc();
  const w = d.width, h = d.height;
  const px = PS.flatCtx.getImageData(0, 0, w, h).data;
  const si = (y * w + x) * 4;
  const sr = px[si], sg = px[si + 1], sb = px[si + 2], sa = px[si + 3];
  const tol = PS.toolOpts.tolerance;
  const match = (i) =>
    Math.abs(px[i] - sr) <= tol && Math.abs(px[i + 1] - sg) <= tol &&
    Math.abs(px[i + 2] - sb) <= tol && Math.abs(px[i + 3] - sa) <= tol;
  const mimg = new ImageData(w, h);
  const md = mimg.data;
  if (PS.toolOpts.contiguous) {
    const seen = new Uint8Array(w * h);
    const stack = [y * w + x];
    seen[y * w + x] = 1;
    while (stack.length) {
      const idx = stack.pop();
      const i = idx * 4;
      if (!match(i)) continue;
      md[i + 3] = 255;
      const cx = idx % w, cy = (idx / w) | 0;
      if (cx > 0 && !seen[idx - 1]) { seen[idx - 1] = 1; stack.push(idx - 1); }
      if (cx < w - 1 && !seen[idx + 1]) { seen[idx + 1] = 1; stack.push(idx + 1); }
      if (cy > 0 && !seen[idx - w]) { seen[idx - w] = 1; stack.push(idx - w); }
      if (cy < h - 1 && !seen[idx + w]) { seen[idx + w] = 1; stack.push(idx + w); }
    }
  } else {
    for (let i = 0; i < px.length; i += 4) {
      if (match(i)) md[i + 3] = 255;
    }
  }
  const mask = mkCanvas(w, h);
  ctx2d(mask).putImageData(mimg, 0, 0);
  setSelectionFromMask(mask);
}

function sampleComposite(p) {
  const x = Math.floor(p.x), y = Math.floor(p.y);
  const d = PS.doc;
  if (x < 0 || y < 0 || x >= d.width || y >= d.height) return null;
  compositeDoc();
  const px = PS.flatCtx.getImageData(x, y, 1, 1).data;
  if (px[3] === 0) return null;
  return rgbToHex(px[0], px[1], px[2]);
}

/* One clone-stamp dab: brush-shaped alpha filled with pixels sampled
   from the snapshot at the stroke's source offset. */
function stampClone(s, p) {
  const o = PS.toolOpts;
  const size = Math.max(2, Math.round(o.size));
  const r = size / 2;
  if (!s.stampC || s.stampC.width !== size) {
    s.stampC = mkCanvas(size, size);
  }
  const c = s.stampC.getContext('2d');
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, size, size);
  stampBrush(c, r, r, size, o.hardness, '#ffffff');
  c.globalCompositeOperation = 'source-in';
  const qx = p.x - s.cloneDx, qy = p.y - s.cloneDy;
  c.drawImage(s.cloneSnap, -(qx - r), -(qy - r));
  c.restore();
  s.ctx.drawImage(s.stampC, p.x - r, p.y - r);
}

function cloneSegment(s, from, to) {
  const size = PS.toolOpts.size;
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const spacing = Math.max(size * 0.12, 0.75);
  const steps = Math.max(1, Math.ceil(dist / spacing));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    stampClone(s, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  }
}

/* Smart-guide snapping for the Move tool: snap the dragged layer's edges/
   center to the canvas edges/center when within a screen-space threshold,
   independently per axis (so e.g. horizontal centering doesn't lock
   vertical movement). nx/ny/w/h describe whatever box is being aligned —
   the caller passes the layer's *content* bounding box (see
   getOpaqueBounds), not its raw canvas rect, so a layer with lopsided
   transparent padding still snaps by its visible artwork. Returns the
   (possibly snapped) position plus which doc-space guide lines to draw,
   or null for an axis with no snap. */
function computeMoveSnap(nx, ny, w, h) {
  const d = PS.doc;
  const threshold = 8 / PS.view.zoom;
  const targetsX = [{ at: 0, guide: 0 }, { at: (d.width - w) / 2, guide: d.width / 2 }, { at: d.width - w, guide: d.width }];
  const targetsY = [{ at: 0, guide: 0 }, { at: (d.height - h) / 2, guide: d.height / 2 }, { at: d.height - h, guide: d.height }];
  let bestX = null, bestY = null;
  for (const t of targetsX) if (Math.abs(nx - t.at) < threshold && (!bestX || Math.abs(nx - t.at) < Math.abs(nx - bestX.at))) bestX = t;
  for (const t of targetsY) if (Math.abs(ny - t.at) < threshold && (!bestY || Math.abs(ny - t.at) < Math.abs(ny - bestY.at))) bestY = t;
  return {
    x: bestX ? bestX.at : nx,
    y: bestY ? bestY.at : ny,
    guideV: bestX ? bestX.guide : null,
    guideH: bestY ? bestY.guide : null,
  };
}

const Tools = {
  move: {
    name: 'Move',
    cursor: 'default',
    onDown(p) {
      const L = activeLayer();
      if (!L || isAdjustmentLayer(L)) return; // no content to move — always spans the whole canvas
      this.drag = { layer: L, startX: L.x, startY: L.y, px: p.x, py: p.y, bounds: getOpaqueBounds(L.canvas) };
    },
    onMove(p) {
      const dr = this.drag;
      if (!dr) return;
      const nx = Math.round(dr.startX + (p.x - dr.px));
      const ny = Math.round(dr.startY + (p.y - dr.py));
      const b = dr.bounds;
      const snapped = computeMoveSnap(nx + b.x, ny + b.y, b.w, b.h);
      dr.layer.x = snapped.x - b.x;
      dr.layer.y = snapped.y - b.y;
      PS.snapGuides = (snapped.guideV != null || snapped.guideH != null)
        ? { v: snapped.guideV, h: snapped.guideH } : null;
      requestRender();
    },
    onUp() {
      const dr = this.drag;
      this.drag = null;
      PS.snapGuides = null;
      if (!dr) return;
      const { layer, startX, startY } = dr;
      if (layer.x === startX && layer.y === startY) return;
      const endX = layer.x, endY = layer.y;
      History.push({
        name: 'Move layer',
        undo() { layer.x = startX; layer.y = startY; },
        redo() { layer.x = endX; layer.y = endY; },
      });
    },
    options: ['moveHint'],
  },

  marquee: {
    name: 'Marquee',
    cursor: 'crosshair',
    onDown(p) {
      PS.marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, shape: PS.toolOpts.marqueeShape };
    },
    onMove(p) {
      if (!PS.marquee) return;
      PS.marquee.x1 = p.x; PS.marquee.y1 = p.y;
      requestRender();
    },
    onUp() {
      const m = PS.marquee;
      PS.marquee = null;
      if (!m) return;
      const x = Math.min(m.x0, m.x1), y = Math.min(m.y0, m.y1);
      const w = Math.abs(m.x1 - m.x0), h = Math.abs(m.y1 - m.y0);
      if (w < 2 || h < 2) clearSelection();
      else if (m.shape === 'ellipse') setSelection([ellipsePts(x + w / 2, y + h / 2, w / 2, h / 2)]);
      else setSelection([rectPts(x, y, w, h)]);
      requestRender();
    },
    options: ['marqueeShape', 'selHint'],
  },

  lasso: {
    name: 'Lasso',
    cursor: 'crosshair',
    onDown(p) { PS.lassoPts = [p]; },
    onMove(p) {
      if (!PS.lassoPts) return;
      const last = PS.lassoPts[PS.lassoPts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > 1.5) PS.lassoPts.push(p);
      requestRender();
    },
    onUp() {
      const pts = PS.lassoPts;
      PS.lassoPts = null;
      if (!pts || pts.length < 3) clearSelection();
      else setSelection([pts]);
      requestRender();
    },
    options: ['selHint'],
  },

  wand: {
    name: 'Magic wand',
    cursor: 'crosshair',
    onDown(p) { magicWandSelect(p); },
    onMove() {}, onUp() {},
    options: ['tolerance', 'contiguous', 'wandHint'],
  },

  crop: {
    name: 'Crop',
    cursor: 'crosshair',
    onDown(p) {
      const d = PS.doc;
      this.drag = { x0: clamp(p.x, 0, d.width), y0: clamp(p.y, 0, d.height) };
      PS.cropRect = null;
      requestRender();
    },
    onMove(p) {
      const dr = this.drag;
      if (!dr) return;
      const d = PS.doc;
      const x1 = clamp(p.x, 0, d.width), y1 = clamp(p.y, 0, d.height);
      PS.cropRect = {
        x: Math.min(dr.x0, x1), y: Math.min(dr.y0, y1),
        w: Math.abs(x1 - dr.x0), h: Math.abs(y1 - dr.y0),
      };
      requestRender();
    },
    onUp() {
      this.drag = null;
      if (PS.cropRect && (PS.cropRect.w < 3 || PS.cropRect.h < 3)) PS.cropRect = null;
      requestRender();
    },
    options: ['cropHint'],
  },

  brush: makePaintTool('paint', 'Brush stroke'),
  eraser: makePaintTool('erase', 'Eraser'),
  dodge: makeToneTool('dodge'),
  burn: makeToneTool('burn'),

  clone: {
    name: 'Clone stamp',
    cursor: 'none',
    onDown(p, e) {
      if (e && e.altKey) {
        PS.clone = { src: p, offset: null };
        return;
      }
      if (!PS.clone) return;
      compositeDoc();
      const o = PS.toolOpts;
      const s = beginStroke('paint', o.opacity, 'Clone stamp');
      if (!s) return;
      if (!PS.clone.offset) PS.clone.offset = { dx: p.x - PS.clone.src.x, dy: p.y - PS.clone.src.y };
      s.cloneDx = PS.clone.offset.dx;
      s.cloneDy = PS.clone.offset.dy;
      s.cloneSnap = cloneCanvas(PS.flat);
      s.last = p;
      stampClone(s, p);
      requestRender();
    },
    onMove(p) {
      const s = PS.stroke;
      if (!s || !s.cloneSnap) return;
      cloneSegment(s, s.last, p);
      s.last = p;
      requestRender();
    },
    onUp() { commitStroke(); },
    options: ['size', 'hardness', 'opacity', 'cloneHint'],
  },

  fill: {
    name: 'Paint bucket',
    cursor: 'crosshair',
    onDown(p) { floodFill(p); },
    onMove() {}, onUp() {},
    options: ['tolerance'],
  },

  gradient: {
    name: 'Gradient',
    cursor: 'crosshair',
    onDown(p) {
      const s = beginStroke('paint', 1, 'Gradient');
      if (!s) return;
      s.gradStart = p;
    },
    onMove(p) {
      const s = PS.stroke;
      if (!s || !s.gradStart) return;
      const d = PS.doc;
      const c = s.ctx;
      c.clearRect(0, 0, d.width, d.height);
      let g;
      if (PS.toolOpts.gradientShape === 'radial') {
        const r = Math.max(1, Math.hypot(p.x - s.gradStart.x, p.y - s.gradStart.y));
        g = c.createRadialGradient(s.gradStart.x, s.gradStart.y, 0, s.gradStart.x, s.gradStart.y, r);
      } else {
        g = c.createLinearGradient(s.gradStart.x, s.gradStart.y, p.x, p.y);
      }
      const fg = hexToRgb(PS.fg), bg = hexToRgb(PS.bg);
      g.addColorStop(0, `rgba(${fg.r},${fg.g},${fg.b},1)`);
      if (PS.toolOpts.gradientType === 'fg-transparent') {
        g.addColorStop(1, `rgba(${fg.r},${fg.g},${fg.b},0)`);
      } else {
        g.addColorStop(1, `rgba(${bg.r},${bg.g},${bg.b},1)`);
      }
      c.fillStyle = g;
      c.fillRect(0, 0, d.width, d.height);
      requestRender();
    },
    onUp(p) {
      const s = PS.stroke;
      if (s && s.gradStart && Math.hypot(p.x - s.gradStart.x, p.y - s.gradStart.y) < 2) {
        cancelStroke();
        return;
      }
      commitStroke();
    },
    options: ['gradientShape', 'gradientType'],
  },

  shape: {
    name: 'Shape',
    cursor: 'crosshair',
    onDown(p) {
      const s = beginStroke('paint', PS.toolOpts.opacity, 'Shape');
      if (!s) return;
      s.shapeStart = p;
    },
    onMove(p, e) {
      const s = PS.stroke;
      if (!s || !s.shapeStart) return;
      const d = PS.doc;
      const c = s.ctx;
      c.clearRect(0, 0, d.width, d.height);
      const a = s.shapeStart;
      let bx = p.x, by = p.y;
      if (e && e.shiftKey) {              // constrain to square / circle / 45°
        const dx = bx - a.x, dy = by - a.y;
        const m = Math.max(Math.abs(dx), Math.abs(dy));
        bx = a.x + Math.sign(dx || 1) * m;
        by = a.y + Math.sign(dy || 1) * m;
      }
      const kind = PS.toolOpts.shapeType;
      c.fillStyle = PS.fg;
      c.strokeStyle = PS.fg;
      if (kind === 'line') {
        c.lineWidth = Math.max(1, PS.toolOpts.size / 4);
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(p.x, p.y);
        c.stroke();
      } else {
        const x = Math.min(a.x, bx), y = Math.min(a.y, by);
        const w = Math.abs(bx - a.x), h = Math.abs(by - a.y);
        c.beginPath();
        if (kind === 'ellipse') c.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        else if (kind === 'rounded') c.roundRect(x, y, w, h, Math.min(12, w / 2, h / 2));
        else c.rect(x, y, w, h);
        c.fill();
      }
      requestRender();
    },
    onUp(p) {
      const s = PS.stroke;
      if (s && s.shapeStart && Math.hypot(p.x - s.shapeStart.x, p.y - s.shapeStart.y) < 2) {
        cancelStroke();
        return;
      }
      commitStroke();
    },
    options: ['shapeType', 'size', 'opacity', 'shapeHint'],
  },

  eyedropper: {
    name: 'Eyedropper',
    cursor: 'crosshair',
    onDown(p, e) {
      const hex = sampleComposite(p);
      if (!hex) return;
      if (e && e.altKey) PS.bg = hex; else PS.fg = hex;
      if (typeof UI !== 'undefined') UI.syncColorUI();
    },
    onMove(p, e) { if (e && e.buttons) this.onDown(p, e); },
    onUp() {},
    options: ['pickHint'],
  },

  text: {
    name: 'Text',
    cursor: 'text',
    onDown(p) { if (typeof UI !== 'undefined') UI.beginTextEntry(p); },
    onMove() {}, onUp() {},
    options: ['fontSize', 'fontFamily'],
  },

  hand: {
    name: 'Hand',
    cursor: 'grab',
    onDownScreen(sx, sy) { this.pan = { sx, sy, px: PS.view.panX, py: PS.view.panY }; },
    onMoveScreen(sx, sy) {
      if (!this.pan) return;
      PS.view.panX = this.pan.px + (sx - this.pan.sx);
      PS.view.panY = this.pan.py + (sy - this.pan.sy);
    },
    onDown() {}, onMove() {},
    onUp() { this.pan = null; },
    options: ['handHint'],
  },

  zoom: {
    name: 'Zoom',
    cursor: 'zoom-in',
    onDown(p, e, sx, sy) {
      if (typeof UI !== 'undefined') UI.zoomAt(e && e.altKey ? 1 / 1.5 : 1.5, sx, sy);
    },
    onMove() {}, onUp() {},
    options: ['zoomHint'],
  },
};

const TOOL_ORDER = [
  ['move', 'V'], ['marquee', 'M'], ['lasso', 'L'], ['wand', 'W'],
  ['crop', 'C'], ['eyedropper', 'I'], ['brush', 'B'], ['clone', 'S'],
  ['eraser', 'E'], ['fill', 'G'], ['gradient', 'R'], ['dodge', 'O'],
  ['burn', 'O'], ['text', 'T'], ['shape', 'U'], ['hand', 'H'], ['zoom', 'Z'],
];
