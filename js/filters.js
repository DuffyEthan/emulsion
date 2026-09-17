'use strict';
/* Emulsion filters: pixel adjustments over the active layer, restricted to
   the selection when one exists. FilterSession mirrors Photoshop's dialog
   model: cache the original, recompute the preview from it on every slider
   move, then commit one history entry (or restore on cancel). */

/* Region of the active layer to filter, intersecting doc, layer and
   selection bounds. Returned in layer-local pixel coords + doc offset. */
function filterRegion(L) {
  const d = PS.doc;
  const sel = d.selection;
  const inter = (a, b) => {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    return { x, y, w: Math.min(a.x + a.w, b.x + b.w) - x, h: Math.min(a.y + a.h, b.y + b.h) - y };
  };
  let r = { x: 0, y: 0, w: d.width, h: d.height };
  r = inter(r, { x: L.x, y: L.y, w: L.canvas.width, h: L.canvas.height });
  if (sel) r = inter(r, sel.bounds);
  if (r.w < 1 || r.h < 1) return null;
  return { docX: r.x, docY: r.y, x: r.x - L.x, y: r.y - L.y, w: r.w, h: r.h };
}

class FilterSession {
  constructor(name) {
    this.name = name;
    this.layer = activeLayer();
    this.valid = false;
    if (!this.layer || isAdjustmentLayer(this.layer)) return; // adjustment layers have no pixels to filter
    this.region = filterRegion(this.layer);
    if (!this.region) return;
    this.before = cloneCanvas(this.layer.canvas);
    this.ctx = ctx2d(this.layer.canvas);
    this.orig = this.ctx.getImageData(this.region.x, this.region.y, this.region.w, this.region.h);
    const sel = PS.doc.selection;
    this.maskData = null;
    if (sel) {
      const mc = ctx2d(selectionMask(sel));
      this.maskData = mc.getImageData(this.region.docX, this.region.docY, this.region.w, this.region.h).data;
    }
    this.valid = true;
  }

  apply(fn) {
    if (!this.valid) return;
    const { w, h } = this.region;
    const img = new ImageData(new Uint8ClampedArray(this.orig.data), w, h);
    fn(img.data, w, h);
    if (this.maskData) {
      const o = this.orig.data, n = img.data, m = this.maskData;
      for (let i = 0, p = 0; i < n.length; i += 4, p += 4) {
        const a = m[p + 3] / 255;
        if (a >= 1) continue;
        n[i] = n[i] * a + o[i] * (1 - a);
        n[i + 1] = n[i + 1] * a + o[i + 1] * (1 - a);
        n[i + 2] = n[i + 2] * a + o[i + 2] * (1 - a);
        n[i + 3] = n[i + 3] * a + o[i + 3] * (1 - a);
      }
    }
    this.ctx.putImageData(img, this.region.x, this.region.y);
    requestRender();
  }

  commit() {
    if (!this.valid) return;
    History.pushPixel(this.name, this.layer, this.before);
    requestRender();
  }

  cancel() {
    if (!this.valid) return;
    this.layer.canvas = this.before;
    requestRender();
  }
}

/* ---------- point adjustments ---------- */

function adjBrightnessContrast(data, w, h, brightness, contrast) {
  const add = brightness * 1.275;
  const c = contrast * 1.275;
  const f = (259 * (c + 255)) / (255 * (259 - c));
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = f * (data[i]     - 128) + 128 + add;
    data[i + 1] = f * (data[i + 1] - 128) + 128 + add;
    data[i + 2] = f * (data[i + 2] - 128) + 128 + add;
  }
}

function adjInvert(data) {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
}

function adjDesaturate(data) {
  for (let i = 0; i < data.length; i += 4) {
    const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = y;
  }
}

function adjHSL(data, w, h, dh, ds, dl) {
  const sMul = 1 + ds / 100;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let hVal = 0, sVal = 0;
    let l = (max + min) / 2;
    const d = max - min;
    if (d !== 0) {
      sVal = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) hVal = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) hVal = (b - r) / d + 2;
      else hVal = (r - g) / d + 4;
      hVal /= 6;
    }
    hVal = (hVal + dh / 360 + 1) % 1;
    sVal = clamp(sVal * sMul, 0, 1);
    if (dl > 0) l = l + (1 - l) * (dl / 100);
    else if (dl < 0) l = l * (1 + dl / 100);
    // hsl -> rgb
    if (sVal === 0) { r = g = b = l; }
    else {
      const q = l < 0.5 ? l * (1 + sVal) : l + sVal - l * sVal;
      const p = 2 * l - q;
      const hue = (t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      r = hue(hVal + 1 / 3); g = hue(hVal); b = hue(hVal - 1 / 3);
    }
    data[i] = r * 255; data[i + 1] = g * 255; data[i + 2] = b * 255;
  }
}

/* ---------- convolution-ish filters ---------- */

/* Gaussian approximated by three box blurs (standard trick), computed on
   premultiplied alpha so transparent regions don't bleed dark halos. */
function boxesForGauss(sigma, n) {
  const wIdeal = Math.sqrt((12 * sigma * sigma / n) + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes;
}

function boxBlurPass(src, dst, w, h, r, horizontal) {
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const stride = horizontal ? 4 : w * 4;
  const lineStride = horizontal ? w * 4 : 4;
  const norm = 1 / (2 * r + 1);
  for (let li = 0; li < lines; li++) {
    const base = li * lineStride;
    let sr = 0, sg = 0, sb = 0, sa = 0;
    for (let i = -r; i <= r; i++) {
      const k = base + clamp(i, 0, len - 1) * stride;
      sr += src[k]; sg += src[k + 1]; sb += src[k + 2]; sa += src[k + 3];
    }
    for (let i = 0; i < len; i++) {
      const o = base + i * stride;
      dst[o] = sr * norm; dst[o + 1] = sg * norm; dst[o + 2] = sb * norm; dst[o + 3] = sa * norm;
      const addK = base + clamp(i + r + 1, 0, len - 1) * stride;
      const subK = base + clamp(i - r, 0, len - 1) * stride;
      sr += src[addK] - src[subK];
      sg += src[addK + 1] - src[subK + 1];
      sb += src[addK + 2] - src[subK + 2];
      sa += src[addK + 3] - src[subK + 3];
    }
  }
}

function gaussianBlur(data, w, h, radius) {
  if (radius < 0.3) return;
  const n = w * h * 4;
  let a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i += 4) {
    const al = data[i + 3] / 255;
    a[i] = data[i] * al; a[i + 1] = data[i + 1] * al; a[i + 2] = data[i + 2] * al; a[i + 3] = data[i + 3];
  }
  const boxes = boxesForGauss(radius, 3);
  for (const size of boxes) {
    const r = (size - 1) / 2;
    boxBlurPass(a, b, w, h, r, true);
    boxBlurPass(b, a, w, h, r, false);
  }
  for (let i = 0; i < n; i += 4) {
    const al = a[i + 3];
    if (al > 0.5) {
      const inv = 255 / al;
      data[i] = a[i] * inv; data[i + 1] = a[i + 1] * inv; data[i + 2] = a[i + 2] * inv;
    } else {
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
    data[i + 3] = al;
  }
}

function unsharpMask(data, w, h, amountPct) {
  const amt = amountPct / 100;
  const orig = new Uint8ClampedArray(data);
  gaussianBlur(data, w, h, 2);
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = orig[i]     + (orig[i]     - data[i])     * amt;
    data[i + 1] = orig[i + 1] + (orig[i + 1] - data[i + 1]) * amt;
    data[i + 2] = orig[i + 2] + (orig[i + 2] - data[i + 2]) * amt;
    data[i + 3] = orig[i + 3];
  }
}
