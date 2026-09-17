'use strict';
/* Emulsion UI shell: viewport, toolbar, menus, panels, dialogs, input. */

const UI = {
  vp: null, vctx: null,
  cssW: 0, cssH: 0, dpr: 1,
  mouse: null,           // last pointer position in viewport CSS px
  pointerActive: false,
  panDrag: null,
  spaceHeld: false,
  checker: null,
  hsv: { h: 30, s: 0.75, v: 0.9 },
  opacityEdit: null,
  textEntry: null,
};

/* ---------- icons ---------- */

const ICONS = {
  move: '<path d="M12 2v20M2 12h20M12 2l-2.6 2.6M12 2l2.6 2.6M12 22l-2.6-2.6M12 22l2.6-2.6M2 12l2.6-2.6M2 12l2.6 2.6M22 12l-2.6-2.6M22 12l-2.6 2.6"/>',
  marquee: '<rect x="4" y="6" width="16" height="12" stroke-dasharray="3 2.6"/>',
  lasso: '<path d="M12 4.5c-5 0-8.5 2.4-8.5 5.3 0 2.9 3.5 5 8.5 5s8.5-2.1 8.5-5c0-2.9-3.5-5.3-8.5-5.3z"/><path d="M8.5 14.5c-.8 2.5-2 4-4 5"/>',
  brush: '<path d="M19.5 4.5c-3.5 1-7.5 5-9.6 8l1.6 1.6c3-2.1 7-6.1 8-9.6z" fill="currentColor" stroke="none"/><path d="M9 13.5c-1.8.2-2.7 1.2-3 2.8-.2 1-.8 1.6-2 2 1.8 1 4.5.7 5.6-.7.8-1 .7-2.6-.6-4.1z" fill="currentColor" stroke="none"/>',
  eraser: '<path d="M4.5 15.5l9-9 5 5-9 9H7z"/><path d="M11 9l5 5"/>',
  fill: '<path d="M11 3.5l7 7-7.5 7.5a2 2 0 0 1-2.8 0L4 14.2a2 2 0 0 1 0-2.8z"/><path d="M4.5 13h12"/><path d="M19.5 15.5c.9 1.4 1.5 2.5 1.5 3.4a1.5 1.5 0 0 1-3 0c0-.9.6-2 1.5-3.4z" fill="currentColor" stroke="none"/>',
  gradient: '<rect x="3.5" y="7" width="17" height="10"/><path d="M6 7v10M8.5 7v10M11 7v10l0 0M13.5 7v10M16 7v10" stroke-opacity=".22"/><path d="M4.8 7v10M7.2 7v10M9.6 7v10" stroke-opacity=".5"/>',
  eyedropper: '<path d="M14.5 6.5l3 3L8 19H5v-3z"/><path d="M13 8l-1.8-1.8M17.5 3.5a2.1 2.1 0 0 1 3 3L18 9l-3-3z" fill="currentColor"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9.5 20h5"/>',
  hand: '<path d="M8 12V5.8a1.3 1.3 0 0 1 2.6 0V11m0-6.5a1.3 1.3 0 0 1 2.6 0V11m0-5a1.3 1.3 0 0 1 2.6 0v6.3m0-3a1.3 1.3 0 0 1 2.6.5c0 4.5-1 9.2-5 9.2h-2.8c-1.7 0-2.7-.8-3.6-2.2L4.6 12a1.3 1.3 0 0 1 2.2-1.3L8 12.5"/>',
  zoom: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M8 10.5h5M10.5 8v5"/>',
  wand: '<path d="M15 3.5l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19.5 10l.6 1.2 1.2.6-1.2.6-.6 1.2-.6-1.2-1.2-.6 1.2-.6zM12.5 10.5L4 19"/>',
  crop: '<path d="M7 3v14h14M3 7h14v14"/>',
  clone: '<path d="M6.5 14.5h11l-1.6-3.2a3.5 3.5 0 1 0-7.8 0z"/><path d="M5 18h14v-3.5H5z"/>',
  dodge: '<circle cx="10" cy="10" r="5.5"/><path d="M14.2 14.2l5.3 5.3"/><path d="M10 7.6v4.8M7.6 10h4.8"/>',
  burn: '<path d="M12 4c2.2 3 5.5 4.8 5.5 9a5.5 5.5 0 1 1-11 0C6.5 8.8 9.8 7 12 4z"/><path d="M12 12c1 1.3 2 2 2 3.5a2 2 0 1 1-4 0c0-1.5 1-2.2 2-3.5z"/>',
  shape: '<rect x="4" y="4" width="10" height="10" rx="1"/><circle cx="15.5" cy="15.5" r="4.5"/>',
};

function iconSvg(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
}

/* ---------- coordinate helpers ---------- */

function screenPt(e) {
  const r = UI.vp.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function docPt(s) {
  const v = PS.view;
  return { x: (s.x - v.panX) / v.zoom, y: (s.y - v.panY) / v.zoom };
}

/* ---------- viewport ---------- */

function makeChecker() {
  const c = mkCanvas(16, 16);
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 16, 16);
  x.fillStyle = '#cfcfcf'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
  return UI.vctx.createPattern(c, 'repeat');
}

function resizeViewport() {
  const ws = document.getElementById('workspace');
  UI.dpr = window.devicePixelRatio || 1;
  UI.cssW = ws.clientWidth;
  UI.cssH = ws.clientHeight;
  UI.vp.width = Math.max(1, Math.round(UI.cssW * UI.dpr));
  UI.vp.height = Math.max(1, Math.round(UI.cssH * UI.dpr));
}

function drawAntsPath(ctx, path, fillRule, t) {
  const z = PS.view.zoom;
  ctx.lineWidth = 1 / z;
  const dash = 4 / z;
  const off = ((t / 100) % 8) / z;
  ctx.setLineDash([dash, dash]);
  ctx.strokeStyle = '#111111';
  ctx.lineDashOffset = -off;
  ctx.stroke(path);
  ctx.strokeStyle = '#ffffff';
  ctx.lineDashOffset = -off + dash;
  ctx.stroke(path);
  ctx.setLineDash([]);
}

function drawViewport(t) {
  const ctx = UI.vctx;
  ctx.setTransform(UI.dpr, 0, 0, UI.dpr, 0, 0);
  ctx.clearRect(0, 0, UI.cssW, UI.cssH);
  const d = PS.doc;
  if (!d) return;
  const v = PS.view;
  const dw = d.width * v.zoom, dh = d.height * v.zoom;

  ctx.save();
  ctx.translate(v.panX, v.panY);
  ctx.fillStyle = UI.checker;
  ctx.fillRect(0, 0, dw, dh);
  ctx.imageSmoothingEnabled = v.zoom < 1;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(PS.flat, 0, 0, dw, dh);
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,.12)';
  ctx.lineWidth = 1;
  ctx.strokeRect(v.panX - .5, v.panY - .5, dw + 1, dh + 1);

  // marching ants: committed selection + in-progress marquee/lasso
  ctx.save();
  ctx.translate(v.panX, v.panY);
  ctx.scale(v.zoom, v.zoom);
  if (d.selection) drawAntsPath(ctx, d.selection.path, d.selection.fillRule, t);
  if (PS.marquee) {
    const m = PS.marquee;
    const x = Math.min(m.x0, m.x1), y = Math.min(m.y0, m.y1);
    const w = Math.abs(m.x1 - m.x0), h = Math.abs(m.y1 - m.y0);
    const p = new Path2D();
    if (m.shape === 'ellipse') p.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    else p.rect(x, y, w, h);
    drawAntsPath(ctx, p, 'nonzero', t);
  }
  if (PS.lassoPts && PS.lassoPts.length > 1) {
    const p = new Path2D();
    p.moveTo(PS.lassoPts[0].x, PS.lassoPts[0].y);
    for (const q of PS.lassoPts) p.lineTo(q.x, q.y);
    drawAntsPath(ctx, p, 'nonzero', t);
  }

  // crop shade: darken everything outside the pending crop
  if (PS.cropRect) {
    const r = PS.cropRect;
    const p = new Path2D();
    p.rect(-1e5, -1e5, 2e5, 2e5);
    p.rect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fill(p, 'evenodd');
    ctx.lineWidth = 1.5 / v.zoom;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.lineWidth = 0.5 / v.zoom;
    ctx.strokeStyle = 'rgba(255,255,255,.4)';
    for (let i = 1; i < 3; i++) {                    // rule-of-thirds guides
      ctx.beginPath();
      ctx.moveTo(r.x + r.w * i / 3, r.y); ctx.lineTo(r.x + r.w * i / 3, r.y + r.h);
      ctx.moveTo(r.x, r.y + r.h * i / 3); ctx.lineTo(r.x + r.w, r.y + r.h * i / 3);
      ctx.stroke();
    }
  }

  // smart guides: shown while dragging with the Move tool, whenever the
  // layer's edge/center lines up with the canvas edge/center
  if (PS.snapGuides) {
    ctx.strokeStyle = '#f0a43c';
    ctx.lineWidth = 1 / v.zoom;
    if (PS.snapGuides.v != null) {
      ctx.beginPath();
      ctx.moveTo(PS.snapGuides.v, -1e4); ctx.lineTo(PS.snapGuides.v, d.height + 1e4);
      ctx.stroke();
    }
    if (PS.snapGuides.h != null) {
      ctx.beginPath();
      ctx.moveTo(-1e4, PS.snapGuides.h); ctx.lineTo(d.width + 1e4, PS.snapGuides.h);
      ctx.stroke();
    }
  }
  ctx.restore();

  drawTransformBox(ctx);

  // brush size cursor
  const brushLike = ['brush', 'eraser', 'clone', 'dodge', 'burn'].includes(PS.tool);
  if (UI.mouse && brushLike && !UI.panDrag && !UI.spaceHeld && !PS.transform) {
    const r = Math.max(1.5, (PS.toolOpts.size / 2) * v.zoom);
    ctx.beginPath();
    ctx.arc(UI.mouse.x, UI.mouse.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,.85)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(UI.mouse.x, UI.mouse.y, r + 1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.stroke();
  }
}

/* ---------- free transform overlay & dragging ---------- */

function transformCornersScreen(tr) {
  const v = PS.view;
  const w = tr.orig.width, h = tr.orig.height;
  const pts = [
    [tr.ox, tr.oy], [tr.ox + w / 2, tr.oy], [tr.ox + w, tr.oy],
    [tr.ox + w, tr.oy + h / 2], [tr.ox + w, tr.oy + h],
    [tr.ox + w / 2, tr.oy + h], [tr.ox, tr.oy + h], [tr.ox, tr.oy + h / 2],
  ];
  return pts.map(([x, y]) => {
    const q = transformPoint(tr, x, y);
    return { x: q.x * v.zoom + v.panX, y: q.y * v.zoom + v.panY, dx: x, dy: y };
  });
}

function drawTransformBox(ctx) {
  const tr = PS.transform;
  if (!tr) return;
  const hs = transformCornersScreen(tr);
  ctx.save();
  ctx.setTransform(UI.dpr, 0, 0, UI.dpr, 0, 0);
  ctx.strokeStyle = 'rgba(240,164,60,.95)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hs[0].x, hs[0].y);
  for (const i of [2, 4, 6]) ctx.lineTo(hs[i].x, hs[i].y);
  ctx.closePath();
  ctx.stroke();
  for (const p of hs) {
    ctx.fillStyle = '#17171a';
    ctx.strokeStyle = 'rgba(240,164,60,.95)';
    ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
    ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
  }
  ctx.restore();
}

function transformHitTest(s) {
  const tr = PS.transform;
  if (!tr) return null;
  const hs = transformCornersScreen(tr);
  for (let i = 0; i < hs.length; i++) {
    if (Math.hypot(s.x - hs[i].x, s.y - hs[i].y) <= 8) {
      return { kind: 'handle', index: i, handle: hs[i] };
    }
  }
  // point-in-quad via the inverse mapping: back to orig rect coords
  const v = PS.view;
  const doc = { x: (s.x - v.panX) / v.zoom, y: (s.y - v.panY) / v.zoom };
  const cs = Math.cos(-tr.rot), sn = Math.sin(-tr.rot);
  const px = doc.x - tr.cx - tr.tx, py = doc.y - tr.cy - tr.ty;
  const ux = (px * cs - py * sn) / (tr.sx || 1e-6) + tr.cx;
  const uy = (px * sn + py * cs) / (tr.sy || 1e-6) + tr.cy;
  if (ux >= tr.ox && ux <= tr.ox + tr.orig.width && uy >= tr.oy && uy <= tr.oy + tr.orig.height) {
    return { kind: 'move' };
  }
  const cx = hs.reduce((a, p) => a + p.x, 0) / hs.length;
  const cy = hs.reduce((a, p) => a + p.y, 0) / hs.length;
  const maxR = Math.max(...hs.map(p => Math.hypot(p.x - cx, p.y - cy)));
  if (Math.hypot(s.x - cx, s.y - cy) <= maxR + 40) return { kind: 'rotate', cx, cy };
  return null;
}

function transformDragStart(s) {
  const hit = transformHitTest(s);
  const tr = PS.transform;
  if (!hit) return false;
  UI.transformDrag = {
    ...hit,
    start: s,
    sx0: tr.sx, sy0: tr.sy, rot0: tr.rot, tx0: tr.tx, ty0: tr.ty,
  };
  if (hit.kind === 'rotate') {
    UI.transformDrag.a0 = Math.atan2(s.y - hit.cy, s.x - hit.cx);
  }
  return true;
}

function transformDragMove(s, e) {
  const dr = UI.transformDrag;
  const tr = PS.transform;
  if (!dr || !tr) return;
  const v = PS.view;
  if (dr.kind === 'move') {
    tr.tx = dr.tx0 + (s.x - dr.start.x) / v.zoom;
    tr.ty = dr.ty0 + (s.y - dr.start.y) / v.zoom;
  } else if (dr.kind === 'rotate') {
    let da = Math.atan2(s.y - dr.cy, s.x - dr.cx) - dr.a0;
    if (e && e.shiftKey) da = Math.round(da / (Math.PI / 12)) * (Math.PI / 12);
    tr.rot = dr.rot0 + da;
  } else {
    /* Scale so the dragged handle follows the pointer while the opposite
       handle stays put: R·S·(u_handle − u_anchor) = q_mouse − q_anchor. */
    const w = tr.orig.width, h = tr.orig.height;
    const locals = [
      [tr.ox, tr.oy], [tr.ox + w / 2, tr.oy], [tr.ox + w, tr.oy],
      [tr.ox + w, tr.oy + h / 2], [tr.ox + w, tr.oy + h],
      [tr.ox + w / 2, tr.oy + h], [tr.ox, tr.oy + h], [tr.ox, tr.oy + h / 2],
    ];
    const hIdx = dr.index, aIdx = (dr.index + 4) % 8;
    const anchorDoc = transformPoint({ ...tr, sx: dr.sx0, sy: dr.sy0, rot: dr.rot0, tx: dr.tx0, ty: dr.ty0 },
      locals[aIdx][0], locals[aIdx][1]);
    const mouse = { x: (s.x - v.panX) / v.zoom, y: (s.y - v.panY) / v.zoom };
    const cs = Math.cos(-dr.rot0), sn = Math.sin(-dr.rot0);
    const mx = mouse.x - anchorDoc.x, my = mouse.y - anchorDoc.y;
    const rx = mx * cs - my * sn, ry = mx * sn + my * cs;
    const ux = locals[hIdx][0] - locals[aIdx][0];
    const uy = locals[hIdx][1] - locals[aIdx][1];
    let nsx = dr.sx0, nsy = dr.sy0;
    if (Math.abs(ux) > 0.01) nsx = rx / ux;
    if (Math.abs(uy) > 0.01) nsy = ry / uy;
    if (e && e.shiftKey && Math.abs(ux) > 0.01 && Math.abs(uy) > 0.01) {
      const m = Math.max(Math.abs(nsx), Math.abs(nsy));
      nsx = Math.sign(nsx || 1) * m;
      nsy = Math.sign(nsy || 1) * m;
    }
    tr.sx = Math.abs(nsx) < 0.01 ? (nsx < 0 ? -0.01 : 0.01) : nsx;
    tr.sy = Math.abs(nsy) < 0.01 ? (nsy < 0 ? -0.01 : 0.01) : nsy;
    tr.rot = dr.rot0;
    // keep the anchor fixed: solve translation from the anchor equation
    const ua = { x: (locals[aIdx][0] - tr.cx) * tr.sx, y: (locals[aIdx][1] - tr.cy) * tr.sy };
    const c2 = Math.cos(tr.rot), s2 = Math.sin(tr.rot);
    tr.tx = anchorDoc.x - (ua.x * c2 - ua.y * s2) - tr.cx;
    tr.ty = anchorDoc.y - (ua.x * s2 + ua.y * c2) - tr.cy;
  }
  requestRender();
}

UI.zoomAt = function (factor, sx, sy) {
  const v = PS.view;
  const nz = clamp(v.zoom * factor, 0.03, 32);
  if (sx == null) { sx = UI.cssW / 2; sy = UI.cssH / 2; }
  v.panX = sx - (sx - v.panX) * (nz / v.zoom);
  v.panY = sy - (sy - v.panY) * (nz / v.zoom);
  v.zoom = nz;
  requestRender();
};

function setZoom(z) { UI.zoomAt(z / PS.view.zoom, UI.cssW / 2, UI.cssH / 2); }

function fitToWindow() {
  const d = PS.doc;
  if (!d) return;
  const z = clamp(Math.min((UI.cssW - 64) / d.width, (UI.cssH - 64) / d.height, 1), 0.03, 1);
  PS.view.zoom = z;
  PS.view.panX = (UI.cssW - d.width * z) / 2;
  PS.view.panY = (UI.cssH - d.height * z) / 2;
  requestRender();
}

/* ---------- pointer input ---------- */

function initPointer() {
  const vp = UI.vp;

  vp.addEventListener('pointerdown', (e) => {
    if (!PS.doc) return;
    UI.commitTextEntry();
    vp.setPointerCapture(e.pointerId);
    const s = screenPt(e);
    UI.mouse = s;
    if (UI.spaceHeld || e.button === 1) {
      UI.panDrag = { sx: s.x, sy: s.y, px: PS.view.panX, py: PS.view.panY };
      return;
    }
    if (e.button !== 0) return;
    if (PS.transform) {
      if (transformDragStart(s)) UI.pointerActive = true;
      return;
    }
    if (e.altKey && ['brush', 'fill', 'gradient', 'shape'].includes(PS.tool)) {
      Tools.eyedropper.onDown(docPt(s), e);
      return;
    }
    const tool = Tools[PS.tool];
    UI.pointerActive = true;
    if (PS.tool === 'hand') tool.onDownScreen(s.x, s.y);
    else tool.onDown(docPt(s), e, s.x, s.y);
  });

  vp.addEventListener('pointermove', (e) => {
    const s = screenPt(e);
    UI.mouse = s;
    const p = docPt(s);
    setStatusPos(p);
    if (UI.panDrag) {
      PS.view.panX = UI.panDrag.px + (s.x - UI.panDrag.sx);
      PS.view.panY = UI.panDrag.py + (s.y - UI.panDrag.sy);
      return;
    }
    if (!UI.pointerActive) return;
    if (PS.transform) { transformDragMove(s, e); return; }
    const tool = Tools[PS.tool];
    if (PS.tool === 'hand') tool.onMoveScreen(s.x, s.y);
    else tool.onMove(p, e);
  });

  const finish = (e) => {
    if (UI.panDrag) { UI.panDrag = null; return; }
    if (!UI.pointerActive) return;
    UI.pointerActive = false;
    if (PS.transform) { UI.transformDrag = null; return; }
    const s = screenPt(e);
    Tools[PS.tool].onUp(docPt(s), e);
    refreshPanels();
  };
  vp.addEventListener('pointerup', finish);
  vp.addEventListener('pointercancel', finish);
  vp.addEventListener('dblclick', () => {
    if (PS.transform) { commitFreeTransform(); refreshPanels(); }
    else if (PS.cropRect) applyPendingCrop();
  });
  vp.addEventListener('pointerleave', () => { if (!UI.pointerActive) UI.mouse = null; });

  vp.addEventListener('wheel', (e) => {
    if (!PS.doc) return;
    e.preventDefault();
    const s = screenPt(e);
    if (e.ctrlKey || e.metaKey) {
      UI.zoomAt(Math.exp(-e.deltaY * 0.01), s.x, s.y);
    } else {
      PS.view.panX -= e.deltaX;
      PS.view.panY -= e.deltaY;
    }
  }, { passive: false });

  vp.addEventListener('contextmenu', (e) => e.preventDefault());
}

function updateCursor() {
  const t = Tools[PS.tool];
  UI.vp.style.cursor = (UI.spaceHeld || UI.panDrag) ? 'grab' : (t ? t.cursor : 'default');
}

/* ---------- keyboard ---------- */

function isTyping(e) {
  const el = e.target;
  return el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' ||
    el.tagName === 'TEXTAREA' || el.isContentEditable);
}

function initKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.key === ' ' && !isTyping(e)) {
      UI.spaceHeld = true;
      updateCursor();
      e.preventDefault();
      return;
    }
    if (isTyping(e)) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();

    if (mod) {
      const handled = () => e.preventDefault();
      if (k === 'z') { handled(); e.shiftKey ? History.redo() : History.undo(); }
      else if (k === 'y') { handled(); History.redo(); }
      else if (k === 'a' && PS.doc) { handled(); selectAll(); }
      else if (k === 'd' && PS.doc) { handled(); clearSelection(); }
      else if (k === 'i' && PS.doc) {
        handled();
        if (e.shiftKey) invertSelection();
        else runInstantAdjustment('Invert', (data) => adjInvert(data));
      }
      else if (k === 'e' && PS.doc) { handled(); mergeDown(); refreshPanels(); }
      else if (k === 'x' && PS.doc) { handled(); cutSelection(); refreshPanels(); }
      else if (k === 'c' && PS.doc) { handled(); copySelection(); }
      else if (k === 'v' && PS.doc) { handled(); pasteClipboard(); refreshPanels(); }
      else if (k === 's' && PS.doc) { handled(); saveProject(); }
      else if (k === 't' && PS.doc) { handled(); beginFreeTransform(); }
      else if (k === 'j' && PS.doc) { handled(); duplicateLayer(); refreshPanels(); }
      else if (k === 'n' && e.shiftKey && PS.doc) { handled(); addLayer(); refreshPanels(); }
      else if (k === 'l' && PS.doc) { handled(); levelsDialog(); }
      else if (k === 'm' && PS.doc) { handled(); curvesDialog(); }
      else if (k === 'u' && PS.doc) {
        handled();
        if (e.shiftKey) runInstantAdjustment('Desaturate', d => adjDesaturate(d));
        else hueSaturationDialog();
      }
      else if (k === 'b' && PS.doc) { handled(); colorBalanceDialog(); }
      else if (k === '=' || k === '+') { handled(); UI.zoomAt(1.25); }
      else if (k === '-') { handled(); UI.zoomAt(1 / 1.25); }
      else if (k === '0') { handled(); fitToWindow(); }
      else if (k === '1') { handled(); setZoom(1); }
      return;
    }

    if (e.key === 'Enter') {
      if (PS.transform) { commitFreeTransform(); refreshPanels(); return; }
      if (PS.cropRect) { applyPendingCrop(); return; }
    }
    if (e.key === 'Escape') {
      if (PS.transform) cancelFreeTransform();
      else if (PS.cropRect) { PS.cropRect = null; requestRender(); }
      else if (PS.stroke) cancelStroke();
      else if (PS.doc && PS.doc.selection) clearSelection();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && PS.doc) {
      clearSelectedPixels();
      return;
    }
    if (e.key === '[') { PS.toolOpts.size = Math.max(1, Math.round(PS.toolOpts.size * 0.8)); renderOptions(); return; }
    if (e.key === ']') { PS.toolOpts.size = Math.min(400, Math.max(PS.toolOpts.size + 1, Math.round(PS.toolOpts.size * 1.25))); renderOptions(); return; }
    if (k === 'x') { const t = PS.fg; PS.fg = PS.bg; PS.bg = t; UI.syncColorUI(); return; }
    if (k === 'd') { PS.fg = '#1a1a1a'; PS.bg = '#ffffff'; UI.syncColorUI(); return; }
    if (PS.doc && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k) && PS.tool === 'move') {
      const L = activeLayer();
      const step = e.shiftKey ? 10 : 1;
      const dx = k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0;
      const dy = k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0;
      setLayerProps(L, { x: L.x + dx, y: L.y + dy }, 'Nudge layer');
      e.preventDefault();
      return;
    }
    if (k === 'o') {           // O cycles the toning tools, like CS6
      selectTool(PS.tool === 'dodge' ? 'burn' : 'dodge');
      return;
    }
    for (const [tid, key] of TOOL_ORDER) {
      if (k === key.toLowerCase()) { selectTool(tid); return; }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') { UI.spaceHeld = false; updateCursor(); }
  });
}

/* ---------- toolbar & options ---------- */

function applyPendingCrop() {
  const r = PS.cropRect;
  PS.cropRect = null;
  if (!r || !PS.doc) return;
  cropDocument(r.x, r.y, r.w, r.h);
  refreshPanels();
  updateStatus();
}

function selectTool(id) {
  if (PS.transform) { commitFreeTransform(); refreshPanels(); }
  if (PS.cropRect && id !== 'crop') { PS.cropRect = null; requestRender(); }
  PS.tool = id;
  document.querySelectorAll('.tool-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tool === id));
  document.getElementById('status-tool').textContent =
    Tools[id].name + '  (' + (TOOL_ORDER.find(t => t[0] === id) || ['', ''])[1] + ')';
  renderOptions();
  updateCursor();
}

function buildToolbar() {
  const bar = document.getElementById('toolbar');
  for (const [id, key] of TOOL_ORDER) {
    const b = document.createElement('button');
    b.className = 'tool-btn';
    b.dataset.tool = id;
    b.title = `${Tools[id].name} (${key})`;
    b.innerHTML = iconSvg(id);
    b.addEventListener('click', () => selectTool(id));
    bar.appendChild(b);
  }
}

const OPTION_DEFS = {
  size:      { type: 'range', label: 'Size', min: 1, max: 400, get: () => PS.toolOpts.size, set: v => PS.toolOpts.size = v, fmt: v => v + 'px' },
  hardness:  { type: 'range', label: 'Hardness', min: 0, max: 100, get: () => Math.round(PS.toolOpts.hardness * 100), set: v => PS.toolOpts.hardness = v / 100, fmt: v => v + '%' },
  opacity:   { type: 'range', label: 'Opacity', min: 1, max: 100, get: () => Math.round(PS.toolOpts.opacity * 100), set: v => PS.toolOpts.opacity = v / 100, fmt: v => v + '%' },
  tolerance: { type: 'range', label: 'Tolerance', min: 0, max: 160, get: () => PS.toolOpts.tolerance, set: v => PS.toolOpts.tolerance = v, fmt: v => '' + v },
  gradientType: { type: 'select', label: 'Colors', options: [['fg-bg', 'Foreground → Background'], ['fg-transparent', 'Foreground → Transparent']], get: () => PS.toolOpts.gradientType, set: v => PS.toolOpts.gradientType = v },
  gradientShape: { type: 'select', label: 'Shape', options: [['linear', 'Linear'], ['radial', 'Radial']], get: () => PS.toolOpts.gradientShape, set: v => PS.toolOpts.gradientShape = v },
  marqueeShape: { type: 'select', label: 'Shape', options: [['rect', 'Rectangle'], ['ellipse', 'Ellipse']], get: () => PS.toolOpts.marqueeShape, set: v => PS.toolOpts.marqueeShape = v },
  shapeType: { type: 'select', label: 'Shape', options: [['rectangle', 'Rectangle'], ['rounded', 'Rounded rectangle'], ['ellipse', 'Ellipse'], ['line', 'Line']], get: () => PS.toolOpts.shapeType, set: v => PS.toolOpts.shapeType = v },
  contiguous: { type: 'checkbox', label: 'Contiguous', get: () => PS.toolOpts.contiguous, set: v => PS.toolOpts.contiguous = v },
  exposure:  { type: 'range', label: 'Exposure', min: 1, max: 100, get: () => Math.round(PS.toolOpts.exposure * 100), set: v => PS.toolOpts.exposure = v / 100, fmt: v => v + '%' },
  fontSize:  { type: 'number', label: 'Size', min: 6, max: 500, get: () => PS.toolOpts.fontSize, set: v => PS.toolOpts.fontSize = clamp(v | 0, 6, 500) },
  fontFamily: { type: 'select', label: 'Font', options: [['Helvetica', 'Helvetica'], ['Georgia', 'Georgia'], ['Times New Roman', 'Times'], ['Courier New', 'Courier'], ['Impact', 'Impact']], get: () => PS.toolOpts.fontFamily, set: v => PS.toolOpts.fontFamily = v },
  moveHint:  { type: 'hint', text: 'Drag to move the active layer · arrow keys nudge · ⇧ nudges 10px · ⌘T free transform' },
  selHint:   { type: 'hint', text: 'Drag to select · ⌘D deselect · ⇧⌘I inverse · Delete clears pixels' },
  wandHint:  { type: 'hint', text: 'Click to select similar colors from the composite' },
  cropHint:  { type: 'hint', text: 'Drag the keep-area · Enter or double-click applies · Esc cancels' },
  cloneHint: { type: 'hint', text: '⌥-click sets the source, then paint' },
  shapeHint: { type: 'hint', text: 'Drag to draw with the foreground color · ⇧ constrains · Size sets line weight' },
  pickHint:  { type: 'hint', text: 'Click to set foreground · ⌥-click sets background' },
  handHint:  { type: 'hint', text: 'Drag to pan · or hold Space with any tool' },
  zoomHint:  { type: 'hint', text: 'Click to zoom in · ⌥-click zooms out · ⌘0 fits · ⌘1 is 100%' },
};

function renderOptions() {
  const bar = document.getElementById('optionsbar');
  bar.innerHTML = '';
  const tool = Tools[PS.tool];
  const title = document.createElement('span');
  title.style.color = 'var(--text)';
  title.style.fontWeight = '600';
  title.textContent = tool.name;
  bar.appendChild(title);
  for (const key of tool.options || []) {
    const def = OPTION_DEFS[key];
    if (!def) continue;
    if (def.type === 'hint') {
      const s = document.createElement('span');
      s.className = 'opt-hint';
      s.textContent = def.text;
      bar.appendChild(s);
      continue;
    }
    const label = document.createElement('label');
    label.append(def.label);
    if (def.type === 'range') {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = def.min; input.max = def.max;
      input.value = def.get();
      const val = document.createElement('span');
      val.className = 'opt-val';
      val.textContent = def.fmt(def.get());
      input.addEventListener('input', () => {
        def.set(+input.value);
        val.textContent = def.fmt(+input.value);
      });
      label.append(input, val);
    } else if (def.type === 'select') {
      const sel = document.createElement('select');
      for (const [v, text] of def.options) {
        const o = document.createElement('option');
        o.value = v; o.textContent = text;
        sel.appendChild(o);
      }
      sel.value = def.get();
      sel.addEventListener('change', () => def.set(sel.value));
      label.append(sel);
    } else if (def.type === 'number') {
      const input = document.createElement('input');
      input.type = 'number';
      input.min = def.min; input.max = def.max;
      input.value = def.get();
      input.addEventListener('change', () => { def.set(+input.value); input.value = def.get(); });
      label.append(input);
    } else if (def.type === 'checkbox') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!def.get();
      input.addEventListener('change', () => def.set(input.checked));
      label.prepend(input);
    }
    bar.appendChild(label);
  }
}

/* ---------- menus ---------- */

function menuData() {
  const hasDoc = () => !!PS.doc;
  const hasSel = () => hasDoc() && !!PS.doc.selection;
  const hasPixelLayer = () => hasDoc() && !isAdjustmentLayer(activeLayer());
  const rp = (fn) => () => { fn(); refreshPanels(); };
  return [
    { label: 'File', items: [
      { l: 'New…', run: newDocDialog },
      { l: 'Open image…', run: () => pickFile('image/*,.psd', f => openAnyFile(f, afterOpenErr)) },
      { l: 'Open project…', run: () => pickFile('.emulsion', f => loadProject(f, afterOpenErr)) },
      { sep: true },
      { l: 'Save project', k: '⌘S', when: hasDoc, run: saveProject },
      { sep: true },
      { l: 'Export PNG', when: hasDoc, run: () => exportImage('image/png') },
      { l: 'Export JPEG', when: hasDoc, run: () => exportImage('image/jpeg') },
      { l: 'Export PSD', when: hasDoc, run: exportPSD },
    ]},
    { label: 'Edit', items: [
      { l: 'Undo', k: '⌘Z', when: hasDoc, run: () => History.undo() },
      { l: 'Redo', k: '⇧⌘Z', when: hasDoc, run: () => History.redo() },
      { sep: true },
      { l: 'Cut', k: '⌘X', when: hasPixelLayer, run: rp(cutSelection) },
      { l: 'Copy', k: '⌘C', when: hasPixelLayer, run: copySelection },
      { l: 'Paste', k: '⌘V', when: () => hasDoc() && !!PS.clipboard, run: rp(pasteClipboard) },
      { sep: true },
      { l: 'Fill…', k: '⇧F5', when: hasPixelLayer, run: fillDialog },
      { l: 'Stroke…', when: () => hasSel() && hasPixelLayer(), run: strokeDialog },
      { l: 'Clear selection pixels', k: '⌫', when: () => hasSel() && hasPixelLayer(), run: clearSelectedPixels },
      { sep: true },
      { l: 'Free transform', k: '⌘T', when: hasPixelLayer, run: beginFreeTransform },
      { l: 'Transform', when: hasPixelLayer, items: [
        { l: 'Rotate layer 90° CW', run: rp(() => transformActiveLayer('rot90')) },
        { l: 'Rotate layer 90° CCW', run: rp(() => transformActiveLayer('rot-90')) },
        { l: 'Rotate layer 180°', run: rp(() => transformActiveLayer('rot180')) },
        { l: 'Flip layer horizontal', run: rp(() => transformActiveLayer('flipH')) },
        { l: 'Flip layer vertical', run: rp(() => transformActiveLayer('flipV')) },
      ]},
    ]},
    { label: 'Image', items: [
      { l: 'Image size…', when: hasDoc, run: imageSizeDialog },
      { l: 'Canvas size…', when: hasDoc, run: canvasSizeDialog },
      { l: 'Image rotation', when: hasDoc, items: [
        { l: '90° CW', run: rp(() => rotateCanvasDoc('rot90')) },
        { l: '90° CCW', run: rp(() => rotateCanvasDoc('rot-90')) },
        { l: '180°', run: rp(() => rotateCanvasDoc('rot180')) },
        { l: 'Flip canvas horizontal', run: rp(() => rotateCanvasDoc('flipH')) },
        { l: 'Flip canvas vertical', run: rp(() => rotateCanvasDoc('flipV')) },
      ]},
      { l: 'Crop to selection', when: hasSel,
        run: () => { const b = PS.doc.selection.bounds; cropDocument(b.x, b.y, b.w, b.h); refreshPanels(); } },
      { sep: true },
      { l: 'Flatten image', when: hasDoc, run: rp(flattenImage) },
    ]},
    { label: 'Adjust', items: [
      { l: 'Brightness / Contrast…', when: hasPixelLayer, run: brightnessContrastDialog },
      { l: 'Levels…', k: '⌘L', when: hasPixelLayer, run: levelsDialog },
      { l: 'Curves…', k: '⌘M', when: hasPixelLayer, run: curvesDialog },
      { l: 'Exposure…', when: hasPixelLayer, run: exposureDialog },
      { sep: true },
      { l: 'Vibrance…', when: hasPixelLayer, run: vibranceDialog },
      { l: 'Hue / Saturation…', k: '⌘U', when: hasPixelLayer, run: hueSaturationDialog },
      { l: 'Color balance…', k: '⌘B', when: hasPixelLayer, run: colorBalanceDialog },
      { l: 'Black & white…', when: hasPixelLayer, run: blackWhiteDialog },
      { l: 'Photo filter…', when: hasPixelLayer, run: photoFilterDialog },
      { sep: true },
      { l: 'Invert', k: '⌘I', when: hasPixelLayer, run: () => runInstantAdjustment('Invert', d => adjInvert(d)) },
      { l: 'Desaturate', k: '⇧⌘U', when: hasPixelLayer, run: () => runInstantAdjustment('Desaturate', d => adjDesaturate(d)) },
      { l: 'Posterize…', when: hasPixelLayer, run: posterizeDialog },
      { l: 'Threshold…', when: hasPixelLayer, run: thresholdDialog },
      { l: 'Gradient map…', when: hasPixelLayer, run: gradientMapDialog },
      { sep: true },
      { l: 'Auto tone', when: hasPixelLayer, run: () => runInstantAdjustment('Auto tone', d => adjAutoTone(d)) },
      { l: 'Auto contrast', when: hasPixelLayer, run: () => runInstantAdjustment('Auto contrast', d => adjAutoContrast(d)) },
    ]},
    { label: 'Layer', items: [
      { l: 'New layer', k: '⇧⌘N', when: hasDoc, run: rp(() => addLayer()) },
      { l: 'Duplicate layer', k: '⌘J', when: hasDoc, run: rp(duplicateLayer) },
      { l: 'Delete layer', when: () => hasDoc() && PS.doc.layers.length > 1, run: rp(deleteLayer) },
      { sep: true },
      { l: 'New adjustment layer', when: hasDoc, items: [
        { l: 'Brightness/Contrast…', run: () => newAdjustmentLayer('brightnessContrast') },
        { l: 'Levels…', run: () => newAdjustmentLayer('levels') },
        { l: 'Curves…', run: () => newAdjustmentLayer('curves') },
        { l: 'Exposure…', run: () => newAdjustmentLayer('exposure') },
        { sep: true },
        { l: 'Vibrance…', run: () => newAdjustmentLayer('vibrance') },
        { l: 'Hue/Saturation…', run: () => newAdjustmentLayer('hueSaturation') },
        { l: 'Color Balance…', run: () => newAdjustmentLayer('colorBalance') },
        { l: 'Black & White…', run: () => newAdjustmentLayer('blackWhite') },
        { l: 'Photo Filter…', run: () => newAdjustmentLayer('photoFilter') },
        { sep: true },
        { l: 'Invert', run: () => newAdjustmentLayer('invert') },
        { l: 'Posterize…', run: () => newAdjustmentLayer('posterize') },
        { l: 'Threshold…', run: () => newAdjustmentLayer('threshold') },
        { l: 'Gradient Map…', run: () => newAdjustmentLayer('gradientMap') },
      ]},
      { sep: true },
      { l: 'Align to canvas', when: hasPixelLayer, items: [
        { l: 'Left', run: rp(() => alignLayer('left')) },
        { l: 'Center horizontal', run: rp(() => alignLayer('h-center')) },
        { l: 'Right', run: rp(() => alignLayer('right')) },
        { sep: true },
        { l: 'Top', run: rp(() => alignLayer('top')) },
        { l: 'Center vertical', run: rp(() => alignLayer('v-center')) },
        { l: 'Bottom', run: rp(() => alignLayer('bottom')) },
      ]},
      { sep: true },
      { l: 'Layer style…', when: hasPixelLayer, run: layerStyleDialog },
      { l: 'Layer mask', when: hasDoc, items: [
        { l: 'Reveal all', when: () => hasDoc() && !activeLayer().mask, run: rp(() => addLayerMask('reveal')) },
        { l: 'Hide all', when: () => hasDoc() && !activeLayer().mask, run: rp(() => addLayerMask('hide')) },
        { l: 'From selection', when: () => hasSel() && !activeLayer().mask, run: rp(() => addLayerMask('selection')) },
        { sep: true },
        { l: 'Apply mask', when: () => hasDoc() && !!activeLayer().mask, run: rp(() => removeLayerMask(true)) },
        { l: 'Delete mask', when: () => hasDoc() && !!activeLayer().mask, run: rp(() => removeLayerMask(false)) },
      ]},
      { sep: true },
      { l: 'Merge down', k: '⌘E', when: () => hasDoc() && PS.doc.activeIndex > 0, run: rp(mergeDown) },
      { l: 'Flatten image', when: hasDoc, run: rp(flattenImage) },
    ]},
    { label: 'Select', items: [
      { l: 'All', k: '⌘A', when: hasDoc, run: selectAll },
      { l: 'Deselect', k: '⌘D', when: hasSel, run: clearSelection },
      { l: 'Inverse', k: '⇧⌘I', when: hasSel, run: invertSelection },
      { sep: true },
      { l: 'Feather…', when: hasSel, run: featherDialog },
    ]},
    { label: 'Filter', items: [
      { l: 'Blur', when: hasDoc, items: [
        { l: 'Gaussian blur…', run: gaussianBlurDialog },
        { l: 'Box blur…', run: boxBlurDialog },
        { l: 'Motion blur…', run: motionBlurDialog },
        { l: 'Radial blur…', run: radialBlurDialog },
      ]},
      { l: 'Sharpen', when: hasDoc, items: [
        { l: 'Unsharp mask…', run: sharpenDialog },
      ]},
      { l: 'Noise', when: hasDoc, items: [
        { l: 'Add noise…', run: addNoiseDialog },
        { l: 'Median…', run: medianDialog },
      ]},
      { l: 'Pixelate', when: hasDoc, items: [
        { l: 'Mosaic…', run: mosaicDialog },
      ]},
      { l: 'Distort', when: hasDoc, items: [
        { l: 'Twirl…', run: twirlDialog },
        { l: 'Pinch…', run: pinchDialog },
        { l: 'Ripple…', run: rippleDialog },
      ]},
      { l: 'Render', when: hasDoc, items: [
        { l: 'Clouds', run: () => runInstantAdjustment('Clouds', (d, w, h) => renderClouds(d, w, h, PS.fg, PS.bg, false)) },
        { l: 'Difference clouds', run: () => runInstantAdjustment('Difference clouds', (d, w, h) => renderClouds(d, w, h, PS.fg, PS.bg, true)) },
      ]},
      { l: 'Stylize', when: hasDoc, items: [
        { l: 'Emboss…', run: embossDialog },
        { l: 'Find edges', run: () => runInstantAdjustment('Find edges', (d, w, h) => findEdges(d, w, h)) },
        { l: 'Solarize', run: () => runInstantAdjustment('Solarize', d => solarize(d)) },
      ]},
      { l: 'Other', when: hasDoc, items: [
        { l: 'High pass…', run: highPassDialog },
      ]},
    ]},
    { label: 'View', items: [
      { l: 'Zoom in', k: '⌘+', run: () => UI.zoomAt(1.25) },
      { l: 'Zoom out', k: '⌘−', run: () => UI.zoomAt(1 / 1.25) },
      { l: 'Fit on screen', k: '⌘0', when: hasDoc, run: fitToWindow },
      { l: 'Actual pixels', k: '⌘1', when: hasDoc, run: () => setZoom(1) },
    ]},
  ];
}

let openMenu = null;

function closeMenus() {
  if (openMenu) {
    document.querySelectorAll('.menu-dropdown').forEach(el => el.remove());
    openMenu.labelEl.classList.remove('open');
    openMenu = null;
  }
}

function buildMenuItems(dd, items) {
  let openSub = null;
  const closeSub = () => {
    if (openSub) { openSub.remove(); openSub = null; }
  };
  for (const item of items) {
    if (item.sep) {
      const s = document.createElement('div');
      s.className = 'menu-sep';
      dd.appendChild(s);
      continue;
    }
    const b = document.createElement('button');
    b.className = 'menu-item' + (item.items ? ' has-sub' : '');
    b.innerHTML = `<span>${item.l}</span>` +
      (item.items ? '<span class="sub-arrow">▸</span>' : '') +
      (item.k ? `<span class="shortcut">${item.k}</span>` : '');
    b.disabled = item.when ? !item.when() : false;
    if (item.items) {
      b.addEventListener('pointerenter', () => {
        closeSub();
        if (b.disabled) return;
        const sub = document.createElement('div');
        sub.className = 'menu-dropdown menu-submenu';
        buildMenuItems(sub, item.items);
        const r = b.getBoundingClientRect();
        document.body.appendChild(sub);
        let left = r.right + 2;
        if (left + sub.offsetWidth > window.innerWidth) left = r.left - sub.offsetWidth - 2;
        sub.style.left = left + 'px';
        sub.style.top = Math.min(r.top - 5, window.innerHeight - sub.offsetHeight - 8) + 'px';
        openSub = sub;
      });
    } else {
      b.addEventListener('pointerenter', closeSub);
      b.addEventListener('click', () => { closeMenus(); item.run(); });
    }
    dd.appendChild(b);
  }
}

function showMenu(menu, labelEl) {
  closeMenus();
  const dd = document.createElement('div');
  dd.className = 'menu-dropdown';
  buildMenuItems(dd, menu.items);
  const r = labelEl.getBoundingClientRect();
  dd.style.left = r.left + 'px';
  dd.style.top = (r.bottom + 4) + 'px';
  document.body.appendChild(dd);
  labelEl.classList.add('open');
  openMenu = { dropdown: dd, labelEl, menu };
}

function buildMenus() {
  const bar = document.getElementById('menubar');
  for (const menu of menuData()) {
    const el = document.createElement('button');
    el.className = 'menu-label';
    el.textContent = menu.label;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (openMenu && openMenu.labelEl === el) closeMenus();
      else showMenu(menu, el);
    });
    el.addEventListener('pointerenter', () => {
      if (openMenu && openMenu.labelEl !== el) showMenu(menu, el);
    });
    bar.appendChild(el);
  }
  window.addEventListener('pointerdown', (e) => {
    if (openMenu && !e.target.closest('.menu-dropdown') && !e.target.classList.contains('menu-label')) {
      closeMenus();
    }
  });
}

/* ---------- file picking / dropping ---------- */

function pickFile(accept, cb) {
  const input = document.getElementById('file-input');
  input.accept = accept;
  input.value = '';
  input.onchange = () => { if (input.files[0]) cb(input.files[0]); };
  input.click();
}

function afterOpenErr(err) {
  if (err) { alert(err.message); return; }
  afterDocChange();
}

function initDragDrop() {
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) openAnyFile(f, afterOpenErr);
  });
}

/* ---------- color panel ---------- */

function drawSVBox() {
  const c = document.getElementById('sv-box');
  const x = c.getContext('2d');
  const rgb = hsvToRgb(UI.hsv.h, 1, 1);
  x.fillStyle = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
  x.fillRect(0, 0, c.width, c.height);
  let g = x.createLinearGradient(0, 0, c.width, 0);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, c.width, c.height);
  g = x.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  x.fillStyle = g;
  x.fillRect(0, 0, c.width, c.height);
  // marker
  const mx = UI.hsv.s * c.width, my = (1 - UI.hsv.v) * c.height;
  x.beginPath(); x.arc(mx, my, 5, 0, Math.PI * 2);
  x.strokeStyle = UI.hsv.v > 0.6 && UI.hsv.s < 0.5 ? '#000' : '#fff';
  x.lineWidth = 1.6;
  x.stroke();
}

function drawHueStrip() {
  const c = document.getElementById('hue-strip');
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, c.width, 0);
  for (let i = 0; i <= 6; i++) {
    const rgb = hsvToRgb(i * 60 % 360, 1, 1);
    g.addColorStop(i / 6, `rgb(${rgb.r},${rgb.g},${rgb.b})`);
  }
  x.fillStyle = g;
  x.fillRect(0, 0, c.width, c.height);
  const mx = (UI.hsv.h / 360) * c.width;
  x.fillStyle = '#fff';
  x.fillRect(mx - 1.5, 0, 3, c.height);
  x.strokeStyle = '#000';
  x.strokeRect(mx - 1.5, 0, 3, c.height);
}

function colorFromHsv() {
  const rgb = hsvToRgb(UI.hsv.h, UI.hsv.s, UI.hsv.v);
  PS.fg = rgbToHex(rgb.r, rgb.g, rgb.b);
  UI.syncColorUI(false);
}

UI.syncColorUI = function (recomputeHsv = true) {
  if (recomputeHsv) {
    const rgb = hexToRgb(PS.fg);
    if (rgb) {
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      if (hsv.s > 0) UI.hsv.h = hsv.h;   // keep hue when moving to grey axis
      UI.hsv.s = hsv.s;
      UI.hsv.v = hsv.v;
    }
  }
  document.getElementById('swatch-fg').style.background = PS.fg;
  document.getElementById('swatch-bg').style.background = PS.bg;
  const hexInput = document.getElementById('color-hex');
  if (document.activeElement !== hexInput) hexInput.value = PS.fg;
  drawSVBox();
  drawHueStrip();
};

function initColorPanel() {
  const sv = document.getElementById('sv-box');
  const hue = document.getElementById('hue-strip');

  const svPick = (e) => {
    const r = sv.getBoundingClientRect();
    UI.hsv.s = clamp((e.clientX - r.left) / r.width, 0, 1);
    UI.hsv.v = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
    colorFromHsv();
  };
  sv.addEventListener('pointerdown', (e) => { sv.setPointerCapture(e.pointerId); svPick(e); });
  sv.addEventListener('pointermove', (e) => { if (e.buttons) svPick(e); });

  const huePick = (e) => {
    const r = hue.getBoundingClientRect();
    UI.hsv.h = clamp((e.clientX - r.left) / r.width, 0, 0.9999) * 360;
    colorFromHsv();
  };
  hue.addEventListener('pointerdown', (e) => { hue.setPointerCapture(e.pointerId); huePick(e); });
  hue.addEventListener('pointermove', (e) => { if (e.buttons) huePick(e); });

  document.getElementById('color-hex').addEventListener('change', (e) => {
    const rgb = hexToRgb(e.target.value);
    if (rgb) { PS.fg = rgbToHex(rgb.r, rgb.g, rgb.b); UI.syncColorUI(); }
    else e.target.value = PS.fg;
  });

  document.getElementById('swatch-bg').addEventListener('click', () => {
    const t = PS.fg; PS.fg = PS.bg; PS.bg = t;
    UI.syncColorUI();
  });

  UI.syncColorUI();
}

/* ---------- layers panel ---------- */

function renderLayers() {
  const d = PS.doc;
  const list = document.getElementById('layer-list');
  list.innerHTML = '';
  if (!d) return;

  const blendSel = document.getElementById('layer-blend');
  const opSlider = document.getElementById('layer-opacity');
  const opVal = document.getElementById('layer-opacity-val');
  const L = activeLayer();
  blendSel.value = L.blendMode;
  opSlider.value = Math.round(L.opacity * 100);
  opVal.textContent = Math.round(L.opacity * 100) + '%';

  for (let i = d.layers.length - 1; i >= 0; i--) {
    const layer = d.layers[i];
    const row = document.createElement('div');
    row.className = 'layer-row' + (i === d.activeIndex ? ' active' : '');

    const eye = document.createElement('button');
    eye.className = 'layer-eye' + (layer.visible ? '' : ' off');
    eye.textContent = '👁';
    eye.title = 'Toggle visibility';
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      setLayerProps(layer, { visible: !layer.visible }, layer.visible ? 'Hide layer' : 'Show layer');
      refreshPanels();
    });

    const thumb = mkCanvas(40, 30);
    const scale = Math.min(40 / d.width, 30 / d.height);
    const tc = thumb.getContext('2d');
    if (isAdjustmentLayer(layer)) {
      thumb.className = 'layer-thumb adjustment' +
        (i === d.activeIndex && !layer.targetMask ? ' targeted' : '');
      thumb.title = 'Adjustment layer — double-click to edit';
      tc.fillStyle = '#3a3a40';
      tc.fillRect(0, 0, 40, 30);
      tc.beginPath();
      tc.arc(20, 15, 10, Math.PI / 2, -Math.PI / 2);
      tc.fillStyle = '#e8e8ec';
      tc.fill();
      tc.beginPath();
      tc.arc(20, 15, 10, -Math.PI / 2, Math.PI / 2);
      tc.fillStyle = '#101013';
      tc.fill();
      thumb.addEventListener('dblclick', (e) => { e.stopPropagation(); editAdjustmentLayer(layer); });
    } else {
      thumb.className = 'layer-thumb' +
        (i === d.activeIndex && !layer.targetMask ? ' targeted' : '');
      thumb.title = 'Layer pixels';
      tc.drawImage(layer.canvas,
        (40 - d.width * scale) / 2 + layer.x * scale,
        (30 - d.height * scale) / 2 + layer.y * scale,
        layer.canvas.width * scale, layer.canvas.height * scale);
    }
    thumb.addEventListener('click', (e) => {
      e.stopPropagation();
      d.activeIndex = i;
      layer.targetMask = false;
      renderLayers();
    });

    let maskThumb = null;
    if (layer.mask) {
      maskThumb = mkCanvas(40, 30);
      maskThumb.className = 'layer-thumb mask' +
        (i === d.activeIndex && layer.targetMask ? ' targeted' : '');
      maskThumb.title = 'Layer mask — click to paint on it';
      const mc = maskThumb.getContext('2d');
      mc.fillStyle = '#000';
      mc.fillRect(0, 0, 40, 30);
      // mask alpha rendered as grayscale: revealed = white
      const tint = mkCanvas(layer.mask.width, layer.mask.height);
      const tt = tint.getContext('2d');
      tt.drawImage(layer.mask, 0, 0);
      tt.globalCompositeOperation = 'source-in';
      tt.fillStyle = '#fff';
      tt.fillRect(0, 0, tint.width, tint.height);
      mc.drawImage(tint,
        (40 - d.width * scale) / 2 + layer.x * scale,
        (30 - d.height * scale) / 2 + layer.y * scale,
        tint.width * scale, tint.height * scale);
      maskThumb.addEventListener('click', (e) => {
        e.stopPropagation();
        d.activeIndex = i;
        layer.targetMask = true;
        renderLayers();
      });
    }

    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = layer.name;
    name.title = 'Double-click to rename';
    name.addEventListener('dblclick', () => {
      const input = document.createElement('input');
      input.value = layer.name;
      name.textContent = '';
      name.appendChild(input);
      input.focus();
      input.select();
      const commit = () => {
        const v = input.value.trim() || layer.name;
        if (v !== layer.name) setLayerProps(layer, { name: v }, 'Rename layer');
        refreshPanels();
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') input.blur();
        if (ev.key === 'Escape') { input.value = layer.name; input.blur(); }
      });
    });

    row.append(eye, thumb);
    if (maskThumb) row.append(maskThumb);
    row.append(name);
    if (layerHasStyles(layer)) {
      const fx = document.createElement('span');
      fx.className = 'layer-fx';
      fx.textContent = 'fx';
      fx.title = 'Layer style — double-click to edit';
      fx.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        d.activeIndex = i;
        layerStyleDialog();
      });
      row.append(fx);
    }
    row.addEventListener('click', () => {
      d.activeIndex = i;
      renderLayers();
    });
    list.appendChild(row);
  }
}

function initLayersPanel() {
  const blendSel = document.getElementById('layer-blend');
  for (const [v, label] of BLEND_MODES) {
    const o = document.createElement('option');
    o.value = v; o.textContent = label;
    blendSel.appendChild(o);
  }
  blendSel.addEventListener('change', () => {
    const L = activeLayer();
    if (L) { setLayerProps(L, { blendMode: blendSel.value }, 'Blend mode'); refreshPanels(); }
  });

  const opSlider = document.getElementById('layer-opacity');
  const opVal = document.getElementById('layer-opacity-val');
  opSlider.addEventListener('input', () => {
    const L = activeLayer();
    if (!L) return;
    if (!UI.opacityEdit) UI.opacityEdit = { layer: L, before: L.opacity };
    L.opacity = opSlider.value / 100;
    opVal.textContent = opSlider.value + '%';
    requestRender();
  });
  opSlider.addEventListener('change', () => {
    const ed = UI.opacityEdit;
    UI.opacityEdit = null;
    if (!ed || ed.before === ed.layer.opacity) return;
    const { layer, before } = ed;
    const after = layer.opacity;
    History.push({
      name: 'Layer opacity',
      undo() { layer.opacity = before; },
      redo() { layer.opacity = after; },
    });
    requestRender();
  });

  document.querySelector('.layers-footer').addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (!act || !PS.doc) return;
    if (act === 'add') addLayer();
    else if (act === 'dup') duplicateLayer();
    else if (act === 'merge') mergeDown();
    else if (act === 'up') moveLayer(1);
    else if (act === 'down') moveLayer(-1);
    else if (act === 'del') deleteLayer();
    refreshPanels();
  });
}

/* ---------- history panel ---------- */

function renderHistory() {
  const list = document.getElementById('history-list');
  list.innerHTML = '';
  if (!PS.doc) return;
  const past = History.undoStack;
  const future = History.redoStack.slice().reverse();
  const all = [...past, ...future];
  all.forEach((entry, i) => {
    const b = document.createElement('button');
    b.className = 'history-item' +
      (i === past.length - 1 ? ' current' : i >= past.length ? ' future' : '');
    b.textContent = entry.name;
    b.addEventListener('click', () => { History.jumpTo(i); });
    list.appendChild(b);
  });
  list.scrollTop = list.scrollHeight;
}

function refreshPanels() {
  renderLayers();
  renderHistory();
}

/* ---------- modal dialogs ---------- */

function showModal({ title, fields, okText = 'OK', onPreview, onOK, onCancel }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `<h3>${title}</h3>`;

  const inputs = {};
  const values = () => {
    const out = {};
    for (const f of fields) {
      if (f.type === 'hint' || f.type === 'canvas' || !f.key) continue;
      if (f.type === 'select' || f.type === 'color') out[f.key] = inputs[f.key].value;
      else if (f.type === 'checkbox') out[f.key] = inputs[f.key].checked;
      else out[f.key] = +inputs[f.key].value;
    }
    return out;
  };

  let previewQueued = false;
  const queuePreview = () => {
    if (!onPreview || previewQueued) return;
    previewQueued = true;
    requestAnimationFrame(() => {
      previewQueued = false;
      onPreview(values());
    });
  };

  for (const f of fields) {
    const row = document.createElement('div');
    row.className = 'modal-field';
    if (f.type === 'hint') {
      row.className = 'modal-hint';
      row.textContent = f.label;
      modal.appendChild(row);
      continue;
    }
    if (f.type === 'canvas') {
      const cv = document.createElement('canvas');
      cv.width = f.width; cv.height = f.height;
      cv.className = 'modal-canvas';
      row.appendChild(cv);
      inputs[f.key] = cv;
      modal.appendChild(row);
      continue;
    }
    const lab = document.createElement('span');
    lab.textContent = f.label;
    row.appendChild(lab);
    let input;
    if (f.type === 'checkbox') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!f.value;
      input.addEventListener('change', queuePreview);
      row.appendChild(input);
    } else if (f.type === 'color') {
      input = document.createElement('input');
      input.type = 'color';
      input.value = f.value;
      input.addEventListener('input', queuePreview);
      row.appendChild(input);
    } else if (f.type === 'select') {
      input = document.createElement('select');
      for (const [v, text] of f.options) {
        const o = document.createElement('option');
        o.value = v; o.textContent = text;
        input.appendChild(o);
      }
      input.value = f.value;
      input.addEventListener('change', queuePreview);
      row.appendChild(input);
    } else if (f.type === 'range') {
      input = document.createElement('input');
      input.type = 'range';
      input.min = f.min; input.max = f.max; input.step = f.step || 1;
      input.value = f.value;
      const val = document.createElement('span');
      val.className = 'opt-val';
      val.textContent = f.value;
      input.addEventListener('input', () => { val.textContent = input.value; queuePreview(); });
      row.append(input, val);
    } else {
      input = document.createElement('input');
      input.type = 'number';
      input.min = f.min; input.max = f.max; input.step = f.step || 1;
      input.value = f.value;
      input.addEventListener('input', queuePreview);
      row.appendChild(input);
    }
    inputs[f.key] = input;
    modal.appendChild(row);
  }

  const btns = document.createElement('div');
  btns.className = 'modal-buttons';
  const cancel = document.createElement('button');
  cancel.className = 'btn';
  cancel.textContent = 'Cancel';
  const ok = document.createElement('button');
  ok.className = 'btn primary';
  ok.textContent = okText;
  btns.append(cancel, ok);
  modal.appendChild(btns);
  overlay.appendChild(modal);
  root.appendChild(overlay);

  const close = () => { root.innerHTML = ''; window.removeEventListener('keydown', keys, true); };
  const doCancel = () => { close(); if (onCancel) onCancel(); };
  const doOK = () => { const v = values(); close(); onOK(v); };
  cancel.addEventListener('click', doCancel);
  ok.addEventListener('click', doOK);
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) doCancel(); });
  const keys = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); doCancel(); }
    if (e.key === 'Enter' && e.target.tagName !== 'SELECT') { e.stopPropagation(); doOK(); }
  };
  window.addEventListener('keydown', keys, true);

  const first = modal.querySelector('input, select');
  if (first) first.focus();
  if (onPreview) queuePreview();
  return { inputs, values, queuePreview, modal };
}

/* ---------- dialogs ---------- */

function newDocDialog() {
  showModal({
    title: 'New document',
    okText: 'Create',
    fields: [
      { key: 'width', label: 'Width (px)', type: 'number', min: 1, max: 8192, value: 1280 },
      { key: 'height', label: 'Height (px)', type: 'number', min: 1, max: 8192, value: 800 },
      { key: 'bg', label: 'Background', type: 'select', value: 'white',
        options: [['white', 'White'], ['transparent', 'Transparent'], ['black', 'Black']] },
    ],
    onOK(v) {
      PS.projectName = 'Untitled';
      newDocument(v.width, v.height, v.bg);
      afterDocChange();
    },
  });
}

function imageSizeDialog() {
  const d = PS.doc;
  showModal({
    title: `Image size — currently ${d.width} × ${d.height}px`,
    okText: 'Resize',
    fields: [{ key: 'scale', label: 'Scale (%)', type: 'range', min: 5, max: 400, value: 100 }],
    onOK(v) {
      if (v.scale !== 100) resizeDocument(v.scale);
      refreshPanels();
      fitToWindow();
    },
  });
}

function filterDialog(title, sessionName, fields, applyFn) {
  const session = new FilterSession(sessionName);
  if (!session.valid) return;
  showModal({
    title,
    fields,
    onPreview(v) { session.apply((data, w, h) => applyFn(data, w, h, v)); },
    onOK(v) {
      session.apply((data, w, h) => applyFn(data, w, h, v));
      session.commit();
      refreshPanels();
    },
    onCancel() { session.cancel(); },
  });
}

function brightnessContrastDialog() {
  filterDialog('Brightness / Contrast', 'Brightness/Contrast', [
    { key: 'brightness', label: 'Brightness', type: 'range', min: -100, max: 100, value: 0 },
    { key: 'contrast', label: 'Contrast', type: 'range', min: -100, max: 100, value: 0 },
  ], (d, w, h, v) => adjBrightnessContrast(d, w, h, v.brightness, v.contrast));
}

function hueSaturationDialog() {
  filterDialog('Hue / Saturation', 'Hue/Saturation', [
    { key: 'hue', label: 'Hue', type: 'range', min: -180, max: 180, value: 0 },
    { key: 'saturation', label: 'Saturation', type: 'range', min: -100, max: 100, value: 0 },
    { key: 'lightness', label: 'Lightness', type: 'range', min: -100, max: 100, value: 0 },
  ], (d, w, h, v) => adjHSL(d, w, h, v.hue, v.saturation, v.lightness));
}

function gaussianBlurDialog() {
  filterDialog('Gaussian blur', 'Gaussian blur', [
    { key: 'radius', label: 'Radius (px)', type: 'range', min: 1, max: 40, value: 6 },
  ], (d, w, h, v) => gaussianBlur(d, w, h, v.radius));
}

function sharpenDialog() {
  filterDialog('Sharpen', 'Sharpen', [
    { key: 'amount', label: 'Amount (%)', type: 'range', min: 10, max: 300, value: 80 },
  ], (d, w, h, v) => unsharpMask(d, w, h, v.amount));
}

function runInstantAdjustment(name, fn) {
  const session = new FilterSession(name);
  if (!session.valid) return;
  session.apply((data, w, h) => fn(data, w, h));
  session.commit();
  refreshPanels();
}

/* ---------- adjustment dialogs ---------- */

function drawHistogramInto(cv, hist) {
  const x = cv.getContext('2d');
  x.fillStyle = '#101013';
  x.fillRect(0, 0, cv.width, cv.height);
  let max = 1;
  for (let i = 0; i < 256; i++) if (hist[i] > max) max = hist[i];
  x.fillStyle = '#8f8f97';
  for (let i = 0; i < 256; i++) {
    const hgt = Math.sqrt(hist[i] / max) * (cv.height - 4);
    const bx = i / 256 * cv.width;
    x.fillRect(bx, cv.height - hgt, cv.width / 256 + 0.5, hgt);
  }
}

function levelsDialog() {
  const session = new FilterSession('Levels');
  if (!session.valid) return;
  const histCache = {};
  let ui;
  const redrawHist = (ch) => {
    if (!histCache[ch]) histCache[ch] = computeHistogram(session.orig.data, ch);
    drawHistogramInto(ui.inputs.hist, histCache[ch]);
  };
  const run = (v) => session.apply((d, w, h) => adjLevels(d, w, h, {
    channel: v.channel, inB: v.inB, gamma: v.gamma / 100, inW: v.inW,
    outB: v.outB, outW: v.outW,
  }));
  ui = showModal({
    title: 'Levels',
    fields: [
      { key: 'channel', label: 'Channel', type: 'select', value: 'rgb',
        options: [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']] },
      { key: 'hist', type: 'canvas', width: 300, height: 84 },
      { key: 'inB', label: 'Input black', type: 'range', min: 0, max: 254, value: 0 },
      { key: 'gamma', label: 'Gamma ×100', type: 'range', min: 10, max: 400, value: 100 },
      { key: 'inW', label: 'Input white', type: 'range', min: 1, max: 255, value: 255 },
      { key: 'outB', label: 'Output black', type: 'range', min: 0, max: 255, value: 0 },
      { key: 'outW', label: 'Output white', type: 'range', min: 0, max: 255, value: 255 },
    ],
    onPreview(v) { redrawHist(v.channel); run(v); },
    onOK(v) { run(v); session.commit(); refreshPanels(); },
    onCancel() { session.cancel(); },
  });
  redrawHist('rgb');
}

function curvesDialog() {
  const session = new FilterSession('Curves');
  if (!session.valid) return;
  const curves = { rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }], r: null, g: null, b: null };
  let ch = 'rgb';
  let queued = false;
  const apply = () => session.apply((d, w, h) => adjCurves(d, w, h, curves));
  const requestApply = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; apply(); });
  };
  const ui = showModal({
    title: 'Curves',
    fields: [
      { key: 'channel', label: 'Channel', type: 'select', value: 'rgb',
        options: [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']] },
      { key: 'curve', type: 'canvas', width: 280, height: 280 },
      { label: 'Click adds a point · drag moves it · double-click removes', type: 'hint' },
    ],
    onPreview() { requestApply(); },
    onOK() { apply(); session.commit(); refreshPanels(); },
    onCancel() { session.cancel(); },
  });
  const cv = ui.inputs.curve;
  const x2 = cv.getContext('2d');
  const pointsFor = () => curves[ch] || (curves[ch] = [{ x: 0, y: 0 }, { x: 255, y: 255 }]);
  const chColor = { rgb: '#d8d8db', r: '#e06a6a', g: '#6fbf6f', b: '#6f8fe0' };
  const draw = () => {
    x2.fillStyle = '#101013';
    x2.fillRect(0, 0, cv.width, cv.height);
    x2.strokeStyle = '#2c2c31';
    x2.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      x2.beginPath();
      x2.moveTo(i / 4 * cv.width, 0); x2.lineTo(i / 4 * cv.width, cv.height);
      x2.moveTo(0, i / 4 * cv.height); x2.lineTo(cv.width, i / 4 * cv.height);
      x2.stroke();
    }
    x2.strokeStyle = '#3a3a40';
    x2.beginPath();
    x2.moveTo(0, cv.height); x2.lineTo(cv.width, 0);
    x2.stroke();
    const lut = curveLUT(pointsFor());
    x2.strokeStyle = chColor[ch];
    x2.lineWidth = 1.6;
    x2.beginPath();
    for (let i = 0; i < 256; i++) {
      const px = i / 255 * cv.width, py = (1 - lut[i] / 255) * cv.height;
      if (i === 0) x2.moveTo(px, py); else x2.lineTo(px, py);
    }
    x2.stroke();
    for (const p of pointsFor()) {
      x2.beginPath();
      x2.arc(p.x / 255 * cv.width, (1 - p.y / 255) * cv.height, 4.5, 0, Math.PI * 2);
      x2.fillStyle = '#f0a43c';
      x2.fill();
    }
  };
  const toCurve = (e) => {
    const r = cv.getBoundingClientRect();
    return {
      x: clamp((e.clientX - r.left) / r.width * 255, 0, 255),
      y: clamp((1 - (e.clientY - r.top) / r.height) * 255, 0, 255),
    };
  };
  let dragIdx = -1;
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const q = toCurve(e);
    const pts = pointsFor();
    dragIdx = -1;
    for (let i = 0; i < pts.length; i++) {
      if (Math.hypot(pts[i].x - q.x, pts[i].y - q.y) < 14) { dragIdx = i; break; }
    }
    if (dragIdx < 0) {
      pts.push({ x: q.x, y: q.y });
      pts.sort((a, b) => a.x - b.x);
      dragIdx = pts.findIndex(p => p.x === q.x && p.y === q.y);
    }
    draw();
    requestApply();
  });
  cv.addEventListener('pointermove', (e) => {
    if (dragIdx < 0 || !e.buttons) return;
    const q = toCurve(e);
    const pts = pointsFor();
    const lo = dragIdx > 0 ? pts[dragIdx - 1].x + 2 : 0;
    const hi = dragIdx < pts.length - 1 ? pts[dragIdx + 1].x - 2 : 255;
    pts[dragIdx] = { x: clamp(q.x, lo, hi), y: q.y };
    draw();
    requestApply();
  });
  cv.addEventListener('pointerup', () => { dragIdx = -1; });
  cv.addEventListener('dblclick', (e) => {
    const q = toCurve(e);
    const pts = pointsFor();
    if (pts.length <= 2) return;
    let best = -1, bd = 14;
    for (let i = 0; i < pts.length; i++) {
      const dd = Math.hypot(pts[i].x - q.x, pts[i].y - q.y);
      if (dd < bd) { bd = dd; best = i; }
    }
    if (best >= 0) {
      pts.splice(best, 1);
      draw();
      requestApply();
    }
  });
  ui.inputs.channel.addEventListener('change', () => { ch = ui.inputs.channel.value; draw(); });
  draw();
}

function exposureDialog() {
  filterDialog('Exposure', 'Exposure', [
    { key: 'ev', label: 'Exposure ×100', type: 'range', min: -300, max: 300, value: 0 },
    { key: 'offset', label: 'Offset ×100', type: 'range', min: -50, max: 50, value: 0 },
    { key: 'gamma', label: 'Gamma ×100', type: 'range', min: 10, max: 300, value: 100 },
  ], (d, w, h, v) => adjExposure(d, w, h, v.ev / 100, v.offset / 100, v.gamma / 100));
}

function vibranceDialog() {
  filterDialog('Vibrance', 'Vibrance', [
    { key: 'vibrance', label: 'Vibrance', type: 'range', min: -100, max: 100, value: 0 },
    { key: 'saturation', label: 'Saturation', type: 'range', min: -100, max: 100, value: 0 },
  ], (d, w, h, v) => adjVibrance(d, w, h, v.vibrance, v.saturation));
}

function colorBalanceDialog() {
  const session = new FilterSession('Color balance');
  if (!session.valid) return;
  const state = { shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0] };
  let tone = 'midtones';
  let ui;
  const run = (v) => {
    state[tone] = [v.cr, v.mg, v.yb];
    session.apply((d, w, h) =>
      adjColorBalance(d, w, h, state.shadows, state.midtones, state.highlights));
  };
  ui = showModal({
    title: 'Color balance',
    fields: [
      { key: 'tone', label: 'Tone range', type: 'select', value: 'midtones',
        options: [['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights']] },
      { key: 'cr', label: 'Cyan ↔ Red', type: 'range', min: -100, max: 100, value: 0 },
      { key: 'mg', label: 'Magenta ↔ Green', type: 'range', min: -100, max: 100, value: 0 },
      { key: 'yb', label: 'Yellow ↔ Blue', type: 'range', min: -100, max: 100, value: 0 },
    ],
    onPreview(v) { run(v); },
    onOK(v) { run(v); session.commit(); refreshPanels(); },
    onCancel() { session.cancel(); },
  });
  ui.inputs.tone.addEventListener('change', () => {
    tone = ui.inputs.tone.value;
    for (const [key, idx] of [['cr', 0], ['mg', 1], ['yb', 2]]) {
      ui.inputs[key].value = state[tone][idx];
      ui.inputs[key].dispatchEvent(new Event('input'));
    }
  });
}

function blackWhiteDialog() {
  filterDialog('Black & white', 'Black & White', [
    { key: 'reds', label: 'Reds', type: 'range', min: -200, max: 300, value: 40 },
    { key: 'yellows', label: 'Yellows', type: 'range', min: -200, max: 300, value: 60 },
    { key: 'greens', label: 'Greens', type: 'range', min: -200, max: 300, value: 40 },
    { key: 'cyans', label: 'Cyans', type: 'range', min: -200, max: 300, value: 60 },
    { key: 'blues', label: 'Blues', type: 'range', min: -200, max: 300, value: 20 },
    { key: 'magentas', label: 'Magentas', type: 'range', min: -200, max: 300, value: 80 },
  ], (d, w, h, v) => adjBlackWhite(d, w, h, v));
}

function photoFilterDialog() {
  filterDialog('Photo filter', 'Photo Filter', [
    { key: 'color', label: 'Filter', type: 'select', value: '#ec8a00', options: [
      ['#ec8a00', 'Warming (85)'], ['#fa9600', 'Warming (LBA)'], ['#ebb113', 'Warming (81)'],
      ['#006dff', 'Cooling (80)'], ['#005dff', 'Cooling (LBB)'], ['#00b5ff', 'Cooling (82)'],
      ['#ac7a33', 'Sepia'], ['#ff0000', 'Red'], ['#00b500', 'Green'],
      ['#0022cd', 'Deep blue'], ['#9c00ff', 'Violet'],
    ]},
    { key: 'density', label: 'Density (%)', type: 'range', min: 1, max: 100, value: 25 },
    { key: 'preserve', label: 'Preserve luminosity', type: 'checkbox', value: true },
  ], (d, w, h, v) => adjPhotoFilter(d, w, h, v.color, v.density, v.preserve));
}

function posterizeDialog() {
  filterDialog('Posterize', 'Posterize', [
    { key: 'levels', label: 'Levels', type: 'range', min: 2, max: 32, value: 4 },
  ], (d, w, h, v) => adjPosterize(d, w, h, v.levels));
}

function thresholdDialog() {
  filterDialog('Threshold', 'Threshold', [
    { key: 'level', label: 'Level', type: 'range', min: 1, max: 255, value: 128 },
  ], (d, w, h, v) => adjThreshold(d, w, h, v.level));
}

function gradientMapDialog() {
  filterDialog('Gradient map', 'Gradient Map', [
    { key: 'from', label: 'Shadow color', type: 'color', value: PS.fg },
    { key: 'to', label: 'Highlight color', type: 'color', value: PS.bg },
    { key: 'reverse', label: 'Reverse', type: 'checkbox', value: false },
  ], (d, w, h, v) => adjGradientMap(d, w, h, v.from, v.to, v.reverse));
}

/* ---------- adjustment layers (non-destructive) ----------
   Every "New Adjustment Layer" entry ends up here (or, for Levels/Curves/
   Color Balance, in one of the three bespoke dialogs below): preview
   writes straight into the live layer's params and asks for a re-render
   (the compositor recomputes the effect from the backdrop every frame —
   see core.js renderAdjustmentSurface), and OK/Cancel push exactly one
   history entry or restore the pre-dialog params. */

function compositeStackBelow(layer) {
  const d = PS.doc;
  const idx = d.layers.indexOf(layer);
  const c = mkCanvas(d.width, d.height);
  const ctx = ctx2d(c);
  for (let i = 0; i < idx; i++) if (d.layers[i].visible) compositeLayerOnto(ctx, d.layers[i], false);
  return c;
}

function commitAdjustmentParams(L, def, before, after) {
  L.adjustment.params = after;
  History.push({
    name: def.label,
    undo() { L.adjustment.params = before; requestRender(); },
    redo() { L.adjustment.params = after; requestRender(); },
  });
  requestRender();
  refreshPanels();
}

function adjustmentLayerDialog(L) {
  const def = ADJUSTMENT_TYPES[L.adjustment.type];
  if (!def || !def.fields || !def.fields.length) return;
  const before = structuredClone(L.adjustment.params);
  const fields = def.fields.map(f => ({ ...f, value: L.adjustment.params[f.key] }));
  showModal({
    title: def.label,
    fields,
    onPreview(v) { L.adjustment.params = v; requestRender(); },
    onOK(v) { commitAdjustmentParams(L, def, before, v); },
    onCancel() { L.adjustment.params = before; requestRender(); },
  });
}

function adjustmentLayerLevelsDialog(L) {
  const def = ADJUSTMENT_TYPES.levels;
  const before = structuredClone(L.adjustment.params);
  const backdrop = compositeStackBelow(L);
  const backdropData = ctx2d(backdrop).getImageData(0, 0, backdrop.width, backdrop.height);
  const histCache = {};
  let ui;
  const redrawHist = (ch) => {
    if (!histCache[ch]) histCache[ch] = computeHistogram(backdropData.data, ch);
    drawHistogramInto(ui.inputs.hist, histCache[ch]);
  };
  const p = L.adjustment.params;
  ui = showModal({
    title: 'Levels',
    fields: [
      { key: 'channel', label: 'Channel', type: 'select', value: p.channel,
        options: [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']] },
      { key: 'hist', type: 'canvas', width: 300, height: 84 },
      { key: 'inB', label: 'Input black', type: 'range', min: 0, max: 254, value: p.inB },
      { key: 'gamma', label: 'Gamma ×100', type: 'range', min: 10, max: 400, value: p.gamma },
      { key: 'inW', label: 'Input white', type: 'range', min: 1, max: 255, value: p.inW },
      { key: 'outB', label: 'Output black', type: 'range', min: 0, max: 255, value: p.outB },
      { key: 'outW', label: 'Output white', type: 'range', min: 0, max: 255, value: p.outW },
    ],
    onPreview(v) { redrawHist(v.channel); L.adjustment.params = v; requestRender(); },
    onOK(v) { commitAdjustmentParams(L, def, before, v); },
    onCancel() { L.adjustment.params = before; requestRender(); },
  });
  redrawHist(p.channel);
}

function adjustmentLayerColorBalanceDialog(L) {
  const def = ADJUSTMENT_TYPES.colorBalance;
  const before = structuredClone(L.adjustment.params);
  const state = structuredClone(L.adjustment.params);
  let tone = 'midtones';
  let ui;
  const run = (v) => {
    state[tone] = [v.cr, v.mg, v.yb];
    L.adjustment.params = state;
    requestRender();
  };
  ui = showModal({
    title: 'Color balance',
    fields: [
      { key: 'tone', label: 'Tone range', type: 'select', value: 'midtones',
        options: [['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights']] },
      { key: 'cr', label: 'Cyan ↔ Red', type: 'range', min: -100, max: 100, value: state.midtones[0] },
      { key: 'mg', label: 'Magenta ↔ Green', type: 'range', min: -100, max: 100, value: state.midtones[1] },
      { key: 'yb', label: 'Yellow ↔ Blue', type: 'range', min: -100, max: 100, value: state.midtones[2] },
    ],
    onPreview(v) { run(v); },
    onOK(v) { run(v); commitAdjustmentParams(L, def, before, state); },
    onCancel() { L.adjustment.params = before; requestRender(); },
  });
  ui.inputs.tone.addEventListener('change', () => {
    tone = ui.inputs.tone.value;
    for (const [key, idx] of [['cr', 0], ['mg', 1], ['yb', 2]]) {
      ui.inputs[key].value = state[tone][idx];
      ui.inputs[key].dispatchEvent(new Event('input'));
    }
  });
}

function adjustmentLayerCurvesDialog(L) {
  const def = ADJUSTMENT_TYPES.curves;
  const before = structuredClone(L.adjustment.params);
  const curves = L.adjustment.params.curves;
  let ch = 'rgb';
  let queued = false;
  const apply = () => { L.adjustment.params = { curves }; requestRender(); };
  const requestApply = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; apply(); });
  };
  const ui = showModal({
    title: 'Curves',
    fields: [
      { key: 'channel', label: 'Channel', type: 'select', value: 'rgb',
        options: [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']] },
      { key: 'curve', type: 'canvas', width: 280, height: 280 },
      { label: 'Click adds a point · drag moves it · double-click removes', type: 'hint' },
    ],
    onPreview() { requestApply(); },
    onOK() { apply(); commitAdjustmentParams(L, def, before, { curves }); },
    onCancel() { L.adjustment.params = before; requestRender(); },
  });
  const cv = ui.inputs.curve;
  const x2 = cv.getContext('2d');
  const pointsFor = () => curves[ch] || (curves[ch] = [{ x: 0, y: 0 }, { x: 255, y: 255 }]);
  const chColor = { rgb: '#d8d8db', r: '#e06a6a', g: '#6fbf6f', b: '#6f8fe0' };
  const draw = () => {
    x2.fillStyle = '#101013';
    x2.fillRect(0, 0, cv.width, cv.height);
    x2.strokeStyle = '#2c2c31';
    x2.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      x2.beginPath();
      x2.moveTo(i / 4 * cv.width, 0); x2.lineTo(i / 4 * cv.width, cv.height);
      x2.moveTo(0, i / 4 * cv.height); x2.lineTo(cv.width, i / 4 * cv.height);
      x2.stroke();
    }
    x2.strokeStyle = '#3a3a40';
    x2.beginPath();
    x2.moveTo(0, cv.height); x2.lineTo(cv.width, 0);
    x2.stroke();
    const lut = curveLUT(pointsFor());
    x2.strokeStyle = chColor[ch];
    x2.lineWidth = 1.6;
    x2.beginPath();
    for (let i = 0; i < 256; i++) {
      const px = i / 255 * cv.width, py = (1 - lut[i] / 255) * cv.height;
      if (i === 0) x2.moveTo(px, py); else x2.lineTo(px, py);
    }
    x2.stroke();
    for (const p of pointsFor()) {
      x2.beginPath();
      x2.arc(p.x / 255 * cv.width, (1 - p.y / 255) * cv.height, 4.5, 0, Math.PI * 2);
      x2.fillStyle = '#f0a43c';
      x2.fill();
    }
  };
  const toCurve = (e) => {
    const r = cv.getBoundingClientRect();
    return {
      x: clamp((e.clientX - r.left) / r.width * 255, 0, 255),
      y: clamp((1 - (e.clientY - r.top) / r.height) * 255, 0, 255),
    };
  };
  let dragIdx = -1;
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const q = toCurve(e);
    const pts = pointsFor();
    dragIdx = -1;
    for (let i = 0; i < pts.length; i++) {
      if (Math.hypot(pts[i].x - q.x, pts[i].y - q.y) < 14) { dragIdx = i; break; }
    }
    if (dragIdx < 0) {
      pts.push({ x: q.x, y: q.y });
      pts.sort((a, b) => a.x - b.x);
      dragIdx = pts.findIndex(p => p.x === q.x && p.y === q.y);
    }
    draw();
    requestApply();
  });
  cv.addEventListener('pointermove', (e) => {
    if (dragIdx < 0 || !e.buttons) return;
    const q = toCurve(e);
    const pts = pointsFor();
    const lo = dragIdx > 0 ? pts[dragIdx - 1].x + 2 : 0;
    const hi = dragIdx < pts.length - 1 ? pts[dragIdx + 1].x - 2 : 255;
    pts[dragIdx] = { x: clamp(q.x, lo, hi), y: q.y };
    draw();
    requestApply();
  });
  cv.addEventListener('pointerup', () => { dragIdx = -1; });
  cv.addEventListener('dblclick', (e) => {
    const q = toCurve(e);
    const pts = pointsFor();
    if (pts.length <= 2) return;
    let best = -1, bd = 14;
    for (let i = 0; i < pts.length; i++) {
      const dd = Math.hypot(pts[i].x - q.x, pts[i].y - q.y);
      if (dd < bd) { bd = dd; best = i; }
    }
    if (best >= 0) {
      pts.splice(best, 1);
      draw();
      requestApply();
    }
  });
  ui.inputs.channel.addEventListener('change', () => { ch = ui.inputs.channel.value; draw(); });
  draw();
}

/* Open the right editor for an existing adjustment layer (double-click in
   the Layers panel), or nothing for a parameter-less type like Invert. */
function editAdjustmentLayer(L) {
  if (!isAdjustmentLayer(L)) return;
  const type = L.adjustment.type;
  if (type === 'levels') adjustmentLayerLevelsDialog(L);
  else if (type === 'curves') adjustmentLayerCurvesDialog(L);
  else if (type === 'colorBalance') adjustmentLayerColorBalanceDialog(L);
  else adjustmentLayerDialog(L);
}

function newAdjustmentLayer(type) {
  const d = PS.doc;
  const def = ADJUSTMENT_TYPES[type];
  if (!d || !def) return;
  const layer = createAdjustmentLayer(type);
  const index = d.activeIndex + 1;
  d.layers.splice(index, 0, layer);
  d.activeIndex = index;
  History.push({
    name: 'New ' + def.label + ' layer',
    undo() { d.layers.splice(index, 1); },
    redo() { d.layers.splice(index, 0, layer); },
  });
  requestRender();
  refreshPanels();
  editAdjustmentLayer(layer);
}

/* ---------- filter dialogs ---------- */

function boxBlurDialog() {
  filterDialog('Box blur', 'Box blur', [
    { key: 'radius', label: 'Radius (px)', type: 'range', min: 1, max: 60, value: 8 },
  ], (d, w, h, v) => boxBlur(d, w, h, v.radius));
}

function motionBlurDialog() {
  filterDialog('Motion blur', 'Motion blur', [
    { key: 'angle', label: 'Angle (°)', type: 'range', min: -90, max: 90, value: 0 },
    { key: 'distance', label: 'Distance (px)', type: 'range', min: 1, max: 100, value: 20 },
  ], (d, w, h, v) => motionBlur(d, w, h, v.angle, v.distance));
}

function radialBlurDialog() {
  filterDialog('Radial blur', 'Radial blur', [
    { key: 'method', label: 'Method', type: 'select', value: 'zoom',
      options: [['zoom', 'Zoom'], ['spin', 'Spin']] },
    { key: 'amount', label: 'Amount', type: 'range', min: 1, max: 100, value: 20 },
  ], (d, w, h, v) => radialBlur(d, w, h, v.amount, v.method));
}

function addNoiseDialog() {
  filterDialog('Add noise', 'Add noise', [
    { key: 'amount', label: 'Amount (%)', type: 'range', min: 1, max: 100, value: 10 },
    { key: 'mono', label: 'Monochromatic', type: 'checkbox', value: true },
  ], (d, w, h, v) => addNoise(d, w, h, v.amount, v.mono));
}

function medianDialog() {
  filterDialog('Median', 'Median', [
    { key: 'radius', label: 'Radius (px)', type: 'range', min: 1, max: 8, value: 2 },
  ], (d, w, h, v) => medianFilter(d, w, h, v.radius));
}

function mosaicDialog() {
  filterDialog('Mosaic', 'Mosaic', [
    { key: 'size', label: 'Cell size (px)', type: 'range', min: 2, max: 64, value: 8 },
  ], (d, w, h, v) => mosaic(d, w, h, v.size));
}

function twirlDialog() {
  filterDialog('Twirl', 'Twirl', [
    { key: 'angle', label: 'Angle (°)', type: 'range', min: -360, max: 360, value: 120 },
  ], (d, w, h, v) => twirl(d, w, h, v.angle));
}

function pinchDialog() {
  filterDialog('Pinch', 'Pinch', [
    { key: 'amount', label: 'Amount (%)', type: 'range', min: -100, max: 100, value: 50 },
  ], (d, w, h, v) => pinch(d, w, h, v.amount));
}

function rippleDialog() {
  filterDialog('Ripple', 'Ripple', [
    { key: 'amount', label: 'Amount (px)', type: 'range', min: 1, max: 60, value: 10 },
    { key: 'period', label: 'Wavelength (px)', type: 'range', min: 4, max: 200, value: 60 },
  ], (d, w, h, v) => ripple(d, w, h, v.amount, v.period));
}

function highPassDialog() {
  filterDialog('High pass', 'High pass', [
    { key: 'radius', label: 'Radius (px)', type: 'range', min: 1, max: 50, value: 10 },
  ], (d, w, h, v) => highPass(d, w, h, v.radius));
}

function embossDialog() {
  filterDialog('Emboss', 'Emboss', [
    { key: 'angle', label: 'Angle (°)', type: 'range', min: 0, max: 360, value: 135 },
    { key: 'amount', label: 'Amount (%)', type: 'range', min: 10, max: 500, value: 100 },
  ], (d, w, h, v) => embossFx(d, w, h, v.angle, v.amount));
}

/* ---------- edit / document dialogs ---------- */

function fillDialog() {
  showModal({
    title: 'Fill',
    okText: 'Fill',
    fields: [
      { key: 'contents', label: 'Contents', type: 'select', value: 'fg', options: [
        ['fg', 'Foreground color'], ['bg', 'Background color'],
        ['black', 'Black'], ['gray', '50% gray'], ['white', 'White'],
      ]},
      { key: 'opacity', label: 'Opacity (%)', type: 'range', min: 1, max: 100, value: 100 },
    ],
    onOK(v) {
      const color = v.contents === 'fg' ? PS.fg : v.contents === 'bg' ? PS.bg
                  : v.contents === 'black' ? '#000000'
                  : v.contents === 'gray' ? '#808080' : '#ffffff';
      fillWithColor(color, v.opacity / 100);
      refreshPanels();
    },
  });
}

function strokeDialog() {
  showModal({
    title: 'Stroke selection',
    okText: 'Stroke',
    fields: [
      { key: 'width', label: 'Width (px)', type: 'number', min: 1, max: 100, value: 3 },
      { key: 'color', label: 'Color', type: 'color', value: PS.fg },
    ],
    onOK(v) {
      strokeSelectionOutline(clamp(v.width, 1, 100), v.color);
      refreshPanels();
    },
  });
}

function featherDialog() {
  showModal({
    title: 'Feather selection',
    okText: 'Feather',
    fields: [
      { key: 'radius', label: 'Radius (px)', type: 'number', min: 1, max: 100, value: 8 },
    ],
    onOK(v) { featherSelection(clamp(v.radius, 1, 100)); },
  });
}

function canvasSizeDialog() {
  const d = PS.doc;
  showModal({
    title: `Canvas size — currently ${d.width} × ${d.height}px`,
    okText: 'Resize',
    fields: [
      { key: 'width', label: 'Width (px)', type: 'number', min: 1, max: 8192, value: d.width },
      { key: 'height', label: 'Height (px)', type: 'number', min: 1, max: 8192, value: d.height },
      { key: 'anchor', label: 'Anchor', type: 'select', value: '0.5,0.5', options: [
        ['0,0', 'Top left'], ['0.5,0', 'Top'], ['1,0', 'Top right'],
        ['0,0.5', 'Left'], ['0.5,0.5', 'Center'], ['1,0.5', 'Right'],
        ['0,1', 'Bottom left'], ['0.5,1', 'Bottom'], ['1,1', 'Bottom right'],
      ]},
    ],
    onOK(v) {
      const [fx, fy] = v.anchor.split(',').map(Number);
      canvasSizeDocument(v.width, v.height, fx, fy);
      refreshPanels();
      fitToWindow();
      updateStatus();
    },
  });
}

/* ---------- layer style dialog ---------- */

function layerStyleDialog() {
  const L = activeLayer();
  if (!L) return;
  const orig = L.styles;
  const g = (eff, key, dflt) => (orig && orig[eff] && orig[eff][key] != null) ? orig[eff][key] : dflt;
  const build = (v) => ({
    shadow: { on: v.shOn, color: v.shColor, opacity: v.shOpacity, angle: v.shAngle, dist: v.shDist, size: v.shSize },
    innerShadow: { on: v.isOn, color: v.isColor, opacity: v.isOpacity, angle: v.isAngle, dist: v.isDist, size: v.isSize },
    outerGlow: { on: v.glOn, color: v.glColor, opacity: v.glOpacity, size: v.glSize },
    stroke: { on: v.stOn, color: v.stColor, opacity: v.stOpacity, size: v.stSize },
    overlay: { on: v.ovOn, color: v.ovColor, opacity: v.ovOpacity },
  });
  showModal({
    title: `Layer style — ${L.name}`,
    fields: [
      { type: 'hint', label: '— Drop shadow —' },
      { key: 'shOn', label: 'Enable', type: 'checkbox', value: g('shadow', 'on', false) },
      { key: 'shColor', label: 'Color', type: 'color', value: g('shadow', 'color', '#000000') },
      { key: 'shOpacity', label: 'Opacity (%)', type: 'range', min: 1, max: 100, value: g('shadow', 'opacity', 60) },
      { key: 'shAngle', label: 'Angle (°)', type: 'range', min: -180, max: 180, value: g('shadow', 'angle', 120) },
      { key: 'shDist', label: 'Distance (px)', type: 'range', min: 0, max: 60, value: g('shadow', 'dist', 8) },
      { key: 'shSize', label: 'Size (px)', type: 'range', min: 0, max: 80, value: g('shadow', 'size', 12) },
      { type: 'hint', label: '— Inner shadow —' },
      { key: 'isOn', label: 'Enable', type: 'checkbox', value: g('innerShadow', 'on', false) },
      { key: 'isColor', label: 'Color', type: 'color', value: g('innerShadow', 'color', '#000000') },
      { key: 'isOpacity', label: 'Opacity (%)', type: 'range', min: 1, max: 100, value: g('innerShadow', 'opacity', 55) },
      { key: 'isAngle', label: 'Angle (°)', type: 'range', min: -180, max: 180, value: g('innerShadow', 'angle', 120) },
      { key: 'isDist', label: 'Distance (px)', type: 'range', min: 0, max: 60, value: g('innerShadow', 'dist', 6) },
      { key: 'isSize', label: 'Size (px)', type: 'range', min: 0, max: 80, value: g('innerShadow', 'size', 10) },
      { type: 'hint', label: '— Outer glow —' },
      { key: 'glOn', label: 'Enable', type: 'checkbox', value: g('outerGlow', 'on', false) },
      { key: 'glColor', label: 'Color', type: 'color', value: g('outerGlow', 'color', '#ffdf80') },
      { key: 'glOpacity', label: 'Opacity (%)', type: 'range', min: 1, max: 100, value: g('outerGlow', 'opacity', 60) },
      { key: 'glSize', label: 'Size (px)', type: 'range', min: 0, max: 80, value: g('outerGlow', 'size', 16) },
      { type: 'hint', label: '— Stroke —' },
      { key: 'stOn', label: 'Enable', type: 'checkbox', value: g('stroke', 'on', false) },
      { key: 'stColor', label: 'Color', type: 'color', value: g('stroke', 'color', PS.fg) },
      { key: 'stOpacity', label: 'Opacity (%)', type: 'range', min: 1, max: 100, value: g('stroke', 'opacity', 100) },
      { key: 'stSize', label: 'Size (px)', type: 'range', min: 1, max: 30, value: g('stroke', 'size', 3) },
      { type: 'hint', label: '— Color overlay —' },
      { key: 'ovOn', label: 'Enable', type: 'checkbox', value: g('overlay', 'on', false) },
      { key: 'ovColor', label: 'Color', type: 'color', value: g('overlay', 'color', PS.fg) },
      { key: 'ovOpacity', label: 'Opacity (%)', type: 'range', min: 1, max: 100, value: g('overlay', 'opacity', 100) },
    ],
    onPreview(v) {
      L.styles = build(v);
      requestRender();
    },
    onOK(v) {
      L.styles = orig;
      setLayerStyles(L, build(v));
      refreshPanels();
    },
    onCancel() {
      L.styles = orig;
      requestRender();
    },
  });
}

/* ---------- text entry ---------- */

UI.beginTextEntry = function (p) {
  UI.commitTextEntry();
  const ws = document.getElementById('workspace');
  const v = PS.view;
  const input = document.createElement('input');
  input.className = 'text-entry';
  input.style.left = (p.x * v.zoom + v.panX) + 'px';
  input.style.top = ((p.y - PS.toolOpts.fontSize) * v.zoom + v.panY) + 'px';
  input.style.font = (PS.toolOpts.fontSize * v.zoom) + 'px ' + PS.toolOpts.fontFamily;
  input.style.color = PS.fg;
  input.style.caretColor = PS.fg;
  ws.appendChild(input);
  UI.textEntry = { input, p };
  setTimeout(() => input.focus(), 0);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') UI.commitTextEntry();
    if (e.key === 'Escape') UI.cancelTextEntry();
  });
  input.addEventListener('blur', () => UI.commitTextEntry());
};

UI.commitTextEntry = function () {
  const te = UI.textEntry;
  if (!te) return;
  UI.textEntry = null;
  const text = te.input.value;
  te.input.remove();
  if (!text.trim()) return;
  const L = activeLayer();
  if (!L) return;
  const before = cloneCanvas(L.canvas);
  const c = L.canvas.getContext('2d');
  c.save();
  c.translate(-L.x, -L.y);
  c.font = PS.toolOpts.fontSize + 'px ' + PS.toolOpts.fontFamily;
  c.fillStyle = PS.fg;
  c.textBaseline = 'alphabetic';
  c.fillText(text, te.p.x, te.p.y);
  c.restore();
  History.pushPixel('Text', L, before);
  refreshPanels();
  requestRender();
};

UI.cancelTextEntry = function () {
  const te = UI.textEntry;
  if (!te) return;
  UI.textEntry = null;
  te.input.remove();
};

/* ---------- status bar ---------- */

function setStatusPos(p) {
  document.getElementById('status-pos').textContent =
    PS.doc ? `${Math.floor(p.x)}, ${Math.floor(p.y)}` : '';
}

function updateStatus() {
  document.getElementById('status-zoom').textContent =
    PS.doc ? Math.round(PS.view.zoom * 100) + '%' : '—';
  document.getElementById('status-size').textContent =
    PS.doc ? `${PS.doc.width} × ${PS.doc.height}px` : '';
  document.getElementById('doc-title').textContent =
    PS.doc ? PS.projectName + '.emulsion' : '';
}

/* ---------- lifecycle ---------- */

function afterDocChange() {
  document.getElementById('start-overlay').classList.add('hidden');
  fitToWindow();
  refreshPanels();
  updateStatus();
}

function initStartOverlay() {
  document.getElementById('start-new').addEventListener('click', newDocDialog);
  document.getElementById('start-open').addEventListener('click', () =>
    pickFile('image/*,.psd', f => openAnyFile(f, afterOpenErr)));
  document.getElementById('start-open-project').addEventListener('click', () =>
    pickFile('.emulsion', f => loadProject(f, afterOpenErr)));
}

function frame(t) {
  if (PS.dirty) { compositeDoc(); PS.dirty = false; }
  drawViewport(t);
  updateStatus();
  requestAnimationFrame(frame);
}

function init() {
  UI.vp = document.getElementById('viewport');
  UI.vctx = UI.vp.getContext('2d');
  resizeViewport();
  UI.checker = makeChecker();

  buildToolbar();
  buildMenus();
  initColorPanel();
  initLayersPanel();
  initPointer();
  initKeyboard();
  initDragDrop();
  initStartOverlay();
  selectTool('brush');

  History.onChange = refreshPanels;

  new ResizeObserver(() => { resizeViewport(); requestRender(); })
    .observe(document.getElementById('workspace'));

  window.addEventListener('beforeunload', (e) => {
    if (PS.doc && History.undoStack.length > 1) e.preventDefault();
  });

  requestAnimationFrame(frame);
}

init();
