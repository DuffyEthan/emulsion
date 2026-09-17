'use strict';
/* Emulsion adjustments — the Image > Adjustments menu of Photoshop CS6.
   Every function here operates on ImageData.data in place, so it plugs
   into FilterSession (live preview + selection masking) for free. */

/* ---------- shared helpers ---------- */

function lumaOf(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }

function applyLUT(data, lr, lg, lb) {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lr[data[i]];
    data[i + 1] = lg[data[i + 1]];
    data[i + 2] = lb[data[i + 2]];
  }
}

/* Histogram of the selected channel: 'rgb' means luminosity. */
function computeHistogram(data, channel) {
  const hist = new Uint32Array(256);
  const ci = channel === 'r' ? 0 : channel === 'g' ? 1 : channel === 'b' ? 2 : -1;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const v = ci >= 0 ? data[i + ci] : Math.round(lumaOf(data[i], data[i + 1], data[i + 2]));
    hist[v]++;
  }
  return hist;
}

/* ---------- Levels ---------- */

function buildLevelsLUT(inB, gamma, inW, outB, outW) {
  const lut = new Uint8ClampedArray(256);
  const span = Math.max(1, inW - inB);
  const g = 1 / Math.max(0.01, gamma);
  for (let i = 0; i < 256; i++) {
    const t = clamp((i - inB) / span, 0, 1);
    lut[i] = outB + (outW - outB) * Math.pow(t, g);
  }
  return lut;
}

function adjLevels(data, w, h, o) {
  const lut = buildLevelsLUT(o.inB, o.gamma, o.inW, o.outB, o.outW);
  const idn = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) idn[i] = i;
  const lr = o.channel === 'rgb' || o.channel === 'r' ? lut : idn;
  const lg = o.channel === 'rgb' || o.channel === 'g' ? lut : idn;
  const lb = o.channel === 'rgb' || o.channel === 'b' ? lut : idn;
  applyLUT(data, lr, lg, lb);
}

/* Auto Tone: stretch each channel to full range, clipping 0.1% at the
   ends. Auto Contrast: same, but one common stretch from luminosity. */
function histEnds(hist, total) {
  const clipN = Math.max(1, total * 0.001);
  let lo = 0, hi = 255, acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > clipN) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > clipN) { hi = i; break; } }
  return hi > lo ? [lo, hi] : [0, 255];
}

function adjAutoTone(data) {
  const total = data.length / 4;
  const luts = [];
  for (const ch of ['r', 'g', 'b']) {
    const [lo, hi] = histEnds(computeHistogram(data, ch), total);
    luts.push(buildLevelsLUT(lo, 1, hi, 0, 255));
  }
  applyLUT(data, luts[0], luts[1], luts[2]);
}

function adjAutoContrast(data) {
  const total = data.length / 4;
  const [lo, hi] = histEnds(computeHistogram(data, 'rgb'), total);
  const lut = buildLevelsLUT(lo, 1, hi, 0, 255);
  applyLUT(data, lut, lut, lut);
}

/* ---------- Curves ----------
   Monotone cubic (Fritsch–Carlson) through the control points, baked
   into a 256-entry LUT. Points: [{x,y}...] with 0..255 coords. */

function curveLUT(points) {
  const lut = new Uint8ClampedArray(256);
  const pts = points.slice().sort((a, b) => a.x - b.x);
  if (pts.length === 0) { for (let i = 0; i < 256; i++) lut[i] = i; return lut; }
  if (pts.length === 1) { lut.fill(clamp(pts[0].y, 0, 255)); return lut; }
  const n = pts.length;
  const dx = [], dy = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(Math.max(1e-6, pts[i + 1].x - pts[i].x));
    dy.push(pts[i + 1].y - pts[i].y);
    m.push(dy[i] / dx[i]);
  }
  t.push(m[0]);
  for (let i = 1; i < n - 1; i++) {
    t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  }
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {           // clamp tangents for monotonicity
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const f = 3 / Math.sqrt(s);
      t[i] = f * a * m[i];
      t[i + 1] = f * b * m[i];
    }
  }
  for (let x = 0; x < 256; x++) {
    if (x <= pts[0].x) { lut[x] = pts[0].y; continue; }
    if (x >= pts[n - 1].x) { lut[x] = pts[n - 1].y; continue; }
    let i = 0;
    while (i < n - 2 && pts[i + 1].x < x) i++;
    const u = (x - pts[i].x) / dx[i];
    const u2 = u * u, u3 = u2 * u;
    lut[x] = (2 * u3 - 3 * u2 + 1) * pts[i].y + (u3 - 2 * u2 + u) * dx[i] * t[i]
           + (-2 * u3 + 3 * u2) * pts[i + 1].y + (u3 - u2) * dx[i] * t[i + 1];
  }
  return lut;
}

/* curves = { rgb, r, g, b } — each a control-point array or null. */
function adjCurves(data, w, h, curves) {
  const master = curves.rgb ? curveLUT(curves.rgb) : null;
  const idn = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) idn[i] = i;
  const per = ['r', 'g', 'b'].map(ch => curves[ch] ? curveLUT(curves[ch]) : idn);
  for (let i = 0; i < data.length; i += 4) {
    let r = per[0][data[i]], g = per[1][data[i + 1]], b = per[2][data[i + 2]];
    if (master) { r = master[r]; g = master[g]; b = master[b]; }
    data[i] = r; data[i + 1] = g; data[i + 2] = b;
  }
}

/* ---------- Exposure ---------- */

function adjExposure(data, w, h, ev, offset, gamma) {
  const mul = Math.pow(2, ev);
  const g = 1 / Math.max(0.1, gamma);
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const v = clamp(i / 255 * mul + offset, 0, 1);
    lut[i] = Math.pow(v, g) * 255;
  }
  applyLUT(data, lut, lut, lut);
}

/* ---------- Vibrance ----------
   Boosts saturation weighted toward the least-saturated pixels, so
   already-vivid colors (and skin) shift less than flat ones. */

function adjVibrance(data, w, h, vibrance, saturation) {
  const v = vibrance / 100, s = saturation / 100;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = (mx - mn) / 255;
    const boost = v * (1 - sat) * 1.6 + s;
    if (boost === 0) continue;
    const gray = lumaOf(r, g, b);
    data[i] = gray + (r - gray) * (1 + boost);
    data[i + 1] = gray + (g - gray) * (1 + boost);
    data[i + 2] = gray + (b - gray) * (1 + boost);
  }
}

/* ---------- Color Balance ----------
   Tent-weighted shadows / midtones / highlights, ±100 per rail. */

function adjColorBalance(data, w, h, sh, mid, hi) {
  const scale = 0.4;
  for (let i = 0; i < data.length; i += 4) {
    const l = lumaOf(data[i], data[i + 1], data[i + 2]) / 255;
    const ws = Math.max(0, 1 - 2 * l);
    const wh = Math.max(0, 2 * l - 1);
    const wm = 1 - ws - wh;
    for (let c = 0; c < 3; c++) {
      const delta = (sh[c] * ws + mid[c] * wm + hi[c] * wh) * scale;
      if (delta) data[i + c] = data[i + c] + delta;
    }
  }
}

/* ---------- Black & White ----------
   Photoshop's algorithm: decompose each pixel into its two adjacent
   hue components above the gray floor, weight each by its slider. */

function adjBlackWhite(data, w, h, o) {
  const wt = { r: o.reds / 100, y: o.yellows / 100, g: o.greens / 100,
               c: o.cyans / 100, b: o.blues / 100, m: o.magentas / 100 };
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const mn = Math.min(r, g, b);
    let gray = mn;
    if (mn === b) {
      const yellow = Math.min(r, g) - b;
      gray += yellow * wt.y + (r > g ? (r - g) * wt.r : (g - r) * wt.g);
    } else if (mn === r) {
      const cyan = Math.min(g, b) - r;
      gray += cyan * wt.c + (g > b ? (g - b) * wt.g : (b - g) * wt.b);
    } else {
      const magenta = Math.min(r, b) - g;
      gray += magenta * wt.m + (r > b ? (r - b) * wt.r : (b - r) * wt.b);
    }
    data[i] = data[i + 1] = data[i + 2] = clamp(gray, 0, 255);
  }
}

/* ---------- Photo Filter ---------- */

function adjPhotoFilter(data, w, h, hex, density, preserveLum) {
  const f = hexToRgb(hex) || { r: 236, g: 138, b: 0 };
  const d = density / 100;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    let nr = r * (1 - d) + (r * f.r / 255) * d;
    let ng = g * (1 - d) + (g * f.g / 255) * d;
    let nb = b * (1 - d) + (b * f.b / 255) * d;
    if (preserveLum) {
      const l0 = lumaOf(r, g, b), l1 = lumaOf(nr, ng, nb);
      if (l1 > 0.001) {
        const k = l0 / l1;
        nr *= k; ng *= k; nb *= k;
      }
    }
    data[i] = nr; data[i + 1] = ng; data[i + 2] = nb;
  }
}

/* ---------- Posterize / Threshold ---------- */

function adjPosterize(data, w, h, levels) {
  const n = clamp(levels, 2, 255);
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.round(Math.min(n - 1, Math.floor(i / 256 * n)) * (255 / (n - 1)));
  }
  applyLUT(data, lut, lut, lut);
}

function adjThreshold(data, w, h, level) {
  for (let i = 0; i < data.length; i += 4) {
    const v = lumaOf(data[i], data[i + 1], data[i + 2]) >= level ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = v;
  }
}

/* ---------- Gradient Map ---------- */

function adjGradientMap(data, w, h, fromHex, toHex, reverse) {
  let a = hexToRgb(fromHex) || { r: 0, g: 0, b: 0 };
  let b = hexToRgb(toHex) || { r: 255, g: 255, b: 255 };
  if (reverse) { const t = a; a = b; b = t; }
  for (let i = 0; i < data.length; i += 4) {
    const t = lumaOf(data[i], data[i + 1], data[i + 2]) / 255;
    data[i] = a.r + (b.r - a.r) * t;
    data[i + 1] = a.g + (b.g - a.g) * t;
    data[i + 2] = a.b + (b.b - a.b) * t;
  }
}

/* ---------- adjustment layers ----------
   One registry drives every non-destructive adjustment layer: what
   Layer > New Adjustment Layer offers, how the compositor applies it live
   (core.js renderAdjustmentSurface), and how js/psd.js maps a handful of
   these to/from real PSD adjustment-layer records. `fields` describes a
   generic slider/select dialog (js/ui.js adjustmentLayerDialog); Levels,
   Curves and Color Balance instead get a bespoke editor (their own
   non-destructive editors in ui.js) because their real Photoshop dialogs
   aren't flat sliders — `fields` is omitted for those three. */
const ADJUSTMENT_TYPES = {
  brightnessContrast: {
    label: 'Brightness/Contrast',
    defaults: { brightness: 0, contrast: 0 },
    fields: [
      { key: 'brightness', label: 'Brightness', type: 'range', min: -100, max: 100 },
      { key: 'contrast', label: 'Contrast', type: 'range', min: -100, max: 100 },
    ],
    apply: (data, w, h, p) => adjBrightnessContrast(data, w, h, p.brightness, p.contrast),
  },
  levels: {
    label: 'Levels',
    defaults: { channel: 'rgb', inB: 0, gamma: 100, inW: 255, outB: 0, outW: 255 },
    apply: (data, w, h, p) => adjLevels(data, w, h, {
      channel: p.channel, inB: p.inB, gamma: p.gamma / 100, inW: p.inW, outB: p.outB, outW: p.outW,
    }),
  },
  curves: {
    label: 'Curves',
    defaults: { curves: { rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }], r: null, g: null, b: null } },
    apply: (data, w, h, p) => adjCurves(data, w, h, p.curves),
  },
  exposure: {
    label: 'Exposure',
    defaults: { ev: 0, offset: 0, gamma: 100 },
    fields: [
      { key: 'ev', label: 'Exposure ×100', type: 'range', min: -300, max: 300 },
      { key: 'offset', label: 'Offset ×100', type: 'range', min: -50, max: 50 },
      { key: 'gamma', label: 'Gamma ×100', type: 'range', min: 10, max: 300 },
    ],
    apply: (data, w, h, p) => adjExposure(data, w, h, p.ev / 100, p.offset / 100, p.gamma / 100),
  },
  vibrance: {
    label: 'Vibrance',
    defaults: { vibrance: 0, saturation: 0 },
    fields: [
      { key: 'vibrance', label: 'Vibrance', type: 'range', min: -100, max: 100 },
      { key: 'saturation', label: 'Saturation', type: 'range', min: -100, max: 100 },
    ],
    apply: (data, w, h, p) => adjVibrance(data, w, h, p.vibrance, p.saturation),
  },
  hueSaturation: {
    label: 'Hue/Saturation',
    defaults: { hue: 0, saturation: 0, lightness: 0 },
    fields: [
      { key: 'hue', label: 'Hue', type: 'range', min: -180, max: 180 },
      { key: 'saturation', label: 'Saturation', type: 'range', min: -100, max: 100 },
      { key: 'lightness', label: 'Lightness', type: 'range', min: -100, max: 100 },
    ],
    apply: (data, w, h, p) => adjHSL(data, w, h, p.hue, p.saturation, p.lightness),
  },
  colorBalance: {
    label: 'Color Balance',
    defaults: { shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0] },
    apply: (data, w, h, p) => adjColorBalance(data, w, h, p.shadows, p.midtones, p.highlights),
  },
  blackWhite: {
    label: 'Black & White',
    defaults: { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 },
    fields: [
      { key: 'reds', label: 'Reds', type: 'range', min: -200, max: 300 },
      { key: 'yellows', label: 'Yellows', type: 'range', min: -200, max: 300 },
      { key: 'greens', label: 'Greens', type: 'range', min: -200, max: 300 },
      { key: 'cyans', label: 'Cyans', type: 'range', min: -200, max: 300 },
      { key: 'blues', label: 'Blues', type: 'range', min: -200, max: 300 },
      { key: 'magentas', label: 'Magentas', type: 'range', min: -200, max: 300 },
    ],
    apply: (data, w, h, p) => adjBlackWhite(data, w, h, p),
  },
  photoFilter: {
    label: 'Photo Filter',
    defaults: { color: '#ec8a00', density: 25, preserve: true },
    fields: [
      { key: 'color', label: 'Filter', type: 'select', options: [
        ['#ec8a00', 'Warming (85)'], ['#fa9600', 'Warming (LBA)'], ['#ebb113', 'Warming (81)'],
        ['#006dff', 'Cooling (80)'], ['#005dff', 'Cooling (LBB)'], ['#00b5ff', 'Cooling (82)'],
        ['#ac7a33', 'Sepia'], ['#ff0000', 'Red'], ['#00b500', 'Green'],
        ['#0022cd', 'Deep blue'], ['#9c00ff', 'Violet'],
      ] },
      { key: 'density', label: 'Density (%)', type: 'range', min: 1, max: 100 },
      { key: 'preserve', label: 'Preserve luminosity', type: 'checkbox' },
    ],
    apply: (data, w, h, p) => adjPhotoFilter(data, w, h, p.color, p.density, p.preserve),
  },
  posterize: {
    label: 'Posterize',
    defaults: { levels: 4 },
    fields: [{ key: 'levels', label: 'Levels', type: 'range', min: 2, max: 32 }],
    apply: (data, w, h, p) => adjPosterize(data, w, h, p.levels),
  },
  threshold: {
    label: 'Threshold',
    defaults: { level: 128 },
    fields: [{ key: 'level', label: 'Level', type: 'range', min: 1, max: 255 }],
    apply: (data, w, h, p) => adjThreshold(data, w, h, p.level),
  },
  gradientMap: {
    label: 'Gradient Map',
    defaults: { from: '#000000', to: '#ffffff', reverse: false },
    fields: [
      { key: 'from', label: 'Shadow color', type: 'color' },
      { key: 'to', label: 'Highlight color', type: 'color' },
      { key: 'reverse', label: 'Reverse', type: 'checkbox' },
    ],
    apply: (data, w, h, p) => adjGradientMap(data, w, h, p.from, p.to, p.reverse),
  },
  invert: {
    label: 'Invert',
    defaults: {},
    fields: [],
    apply: (data) => adjInvert(data),
  },
};
