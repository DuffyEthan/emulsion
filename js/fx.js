'use strict';
/* Emulsion effects — the CS6 Filter menu beyond blur/sharpen.
   Everything operates on ImageData.data in place (FilterSession model).
   Filters that resample work on premultiplied alpha to avoid halos. */

/* ---------- premultiply helpers ---------- */

function premul(data) {
  const n = data.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 4) {
    const a = data[i + 3] / 255;
    out[i] = data[i] * a; out[i + 1] = data[i + 1] * a;
    out[i + 2] = data[i + 2] * a; out[i + 3] = data[i + 3];
  }
  return out;
}

function unpremul(data, pre) {
  for (let i = 0; i < data.length; i += 4) {
    const a = pre[i + 3];
    if (a > 0.5) {
      const inv = 255 / a;
      data[i] = pre[i] * inv; data[i + 1] = pre[i + 1] * inv; data[i + 2] = pre[i + 2] * inv;
    } else {
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
    data[i + 3] = a;
  }
}

/* ---------- Blur ---------- */

function boxBlur(data, w, h, radius) {
  const r = Math.max(1, Math.round(radius));
  const a = premul(data), b = new Float32Array(a.length);
  boxBlurPass(a, b, w, h, r, true);
  boxBlurPass(b, a, w, h, r, false);
  unpremul(data, a);
}

function motionBlur(data, w, h, angleDeg, distance) {
  const dist = clamp(Math.round(distance), 1, 200);
  const rad = angleDeg * Math.PI / 180;
  const dx = Math.cos(rad), dy = -Math.sin(rad);
  const src = premul(data);
  const out = new Float32Array(src.length);
  const n = dist;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < n; k++) {
        const t = k - (n - 1) / 2;
        const sx = clamp(Math.round(x + dx * t), 0, w - 1);
        const sy = clamp(Math.round(y + dy * t), 0, h - 1);
        const i = (sy * w + sx) * 4;
        r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3];
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  unpremul(data, out);
}

/* mode: 'spin' rotates samples about the center, 'zoom' scales them. */
function radialBlur(data, w, h, amount, mode) {
  const src = premul(data);
  const out = new Float32Array(src.length);
  const cx = w / 2, cy = h / 2;
  const N = 17;
  const strength = clamp(amount, 1, 100) / 100;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const vx = x - cx, vy = y - cy;
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < N; k++) {
        const t = (k / (N - 1) - 0.5) * strength;
        let sx, sy;
        if (mode === 'spin') {
          const ang = t * 0.6;
          const cs = Math.cos(ang), sn = Math.sin(ang);
          sx = cx + vx * cs - vy * sn;
          sy = cy + vx * sn + vy * cs;
        } else {
          const s = 1 - t * 0.35;
          sx = cx + vx * s;
          sy = cy + vy * s;
        }
        const i = (clamp(Math.round(sy), 0, h - 1) * w + clamp(Math.round(sx), 0, w - 1)) * 4;
        r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3];
      }
      const o = (y * w + x) * 4;
      out[o] = r / N; out[o + 1] = g / N; out[o + 2] = b / N; out[o + 3] = a / N;
    }
  }
  unpremul(data, out);
}

/* ---------- Noise ---------- */

function addNoise(data, w, h, amount, monochromatic) {
  const amp = amount / 100 * 255;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    if (monochromatic) {
      const n = (Math.random() - 0.5) * 2 * amp;
      data[i] += n; data[i + 1] += n; data[i + 2] += n;
    } else {
      data[i] += (Math.random() - 0.5) * 2 * amp;
      data[i + 1] += (Math.random() - 0.5) * 2 * amp;
      data[i + 2] += (Math.random() - 0.5) * 2 * amp;
    }
  }
}

/* Median (noise reduction) — Huang's sliding-histogram running median. */
function medianFilter(data, w, h, radius) {
  const r = clamp(Math.round(radius), 1, 8);
  const src = new Uint8ClampedArray(data);
  const side = 2 * r + 1, count = side * side, target = (count >> 1) + 1;
  const px = (x, y) => (clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)) * 4;
  for (let ch = 0; ch < 3; ch++) {
    for (let y = 0; y < h; y++) {
      const hist = new Uint16Array(256);
      for (let wy = -r; wy <= r; wy++) {
        for (let wx = -r; wx <= r; wx++) hist[src[px(wx, y + wy) + ch]]++;
      }
      let med = 0, less = 0;
      const settle = () => {
        while (less + hist[med] < target) { less += hist[med]; med++; }
        while (less >= target) { med--; less -= hist[med]; }
      };
      settle();
      data[(y * w) * 4 + ch] = med;
      for (let x = 1; x < w; x++) {
        for (let wy = -r; wy <= r; wy++) {
          const rem = src[px(x - r - 1, y + wy) + ch];
          hist[rem]--; if (rem < med) less--;
          const add = src[px(x + r, y + wy) + ch];
          hist[add]++; if (add < med) less++;
        }
        settle();
        data[(y * w + x) * 4 + ch] = med;
      }
    }
  }
}

/* ---------- Pixelate ---------- */

function mosaic(data, w, h, size) {
  const s = clamp(Math.round(size), 2, 200);
  const src = premul(data);
  for (let by = 0; by < h; by += s) {
    for (let bx = 0; bx < w; bx += s) {
      const ex = Math.min(bx + s, w), ey = Math.min(by + s, h);
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = by; y < ey; y++) {
        for (let x = bx; x < ex; x++) {
          const i = (y * w + x) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3];
          n++;
        }
      }
      r /= n; g /= n; b /= n; a /= n;
      const inv = a > 0.5 ? 255 / a : 0;
      for (let y = by; y < ey; y++) {
        for (let x = bx; x < ex; x++) {
          const i = (y * w + x) * 4;
          data[i] = r * inv; data[i + 1] = g * inv; data[i + 2] = b * inv; data[i + 3] = a;
        }
      }
    }
  }
}

/* ---------- Stylize ---------- */

function embossFx(data, w, h, angleDeg, amount) {
  const rad = angleDeg * Math.PI / 180;
  const ox = Math.round(Math.cos(rad)), oy = Math.round(-Math.sin(rad));
  const amt = amount / 100;
  const src = new Uint8ClampedArray(data);
  const lum = (x, y) => {
    const i = (clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)) * 4;
    return lumaOf(src[i], src[i + 1], src[i + 2]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = 128 + (lum(x - ox, y - oy) - lum(x + ox, y + oy)) * amt * 2;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
  }
}

function findEdges(data, w, h) {
  const src = new Uint8ClampedArray(data);
  const at = (x, y, c) => src[(clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)) * 4 + c];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const gx = at(x + 1, y - 1, c) + 2 * at(x + 1, y, c) + at(x + 1, y + 1, c)
                 - at(x - 1, y - 1, c) - 2 * at(x - 1, y, c) - at(x - 1, y + 1, c);
        const gy = at(x - 1, y + 1, c) + 2 * at(x, y + 1, c) + at(x + 1, y + 1, c)
                 - at(x - 1, y - 1, c) - 2 * at(x, y - 1, c) - at(x + 1, y - 1, c);
        data[i + c] = 255 - Math.min(255, Math.hypot(gx, gy));
      }
    }
  }
}

function solarize(data) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 127) data[i] = 255 - data[i];
    if (data[i + 1] > 127) data[i + 1] = 255 - data[i + 1];
    if (data[i + 2] > 127) data[i + 2] = 255 - data[i + 2];
  }
}

/* ---------- Other ---------- */

function highPass(data, w, h, radius) {
  const orig = new Uint8ClampedArray(data);
  gaussianBlur(data, w, h, radius);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = orig[i] - data[i] + 128;
    data[i + 1] = orig[i + 1] - data[i + 1] + 128;
    data[i + 2] = orig[i + 2] - data[i + 2] + 128;
    data[i + 3] = orig[i + 3];
  }
}

/* ---------- Render: Clouds ----------
   Value-noise fBm between the foreground and background colors,
   like CS6's Filter > Render > Clouds. */

function renderClouds(data, w, h, fgHex, bgHex, difference) {
  const fg = hexToRgb(fgHex) || { r: 0, g: 0, b: 0 };
  const bg = hexToRgb(bgHex) || { r: 255, g: 255, b: 255 };
  const seed = (Math.random() * 0xffff) | 0;
  const hash = (x, y) => {
    let n = x * 374761393 + y * 668265263 + seed * 144665;
    n = (n ^ (n >> 13)) | 0;
    n = Math.imul(n, 1274126177);
    return ((n ^ (n >> 16)) >>> 0) / 4294967295;
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  const noise = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = smooth(x - ix), fy = smooth(y - iy);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const base = Math.max(w, h) / 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let t = 0, amp = 0.5, f = 1 / base;
      for (let o = 0; o < 5; o++) {
        t += noise(x * f, y * f) * amp;
        amp /= 2; f *= 2;
      }
      t = clamp((t - 0.25) * 2, 0, 1);
      const i = (y * w + x) * 4;
      const r = fg.r + (bg.r - fg.r) * t;
      const g = fg.g + (bg.g - fg.g) * t;
      const b = fg.b + (bg.b - fg.b) * t;
      if (difference) {
        data[i] = Math.abs(data[i] - r);
        data[i + 1] = Math.abs(data[i + 1] - g);
        data[i + 2] = Math.abs(data[i + 2] - b);
      } else {
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
      }
    }
  }
}

/* ---------- Distort ----------
   One inverse-mapping engine with bilinear sampling on premultiplied
   alpha; each distortion just supplies dest→source coordinates. */

function remapPixels(data, w, h, map) {
  const src = premul(data);
  const out = new Float32Array(src.length);
  const pt = { x: 0, y: 0 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      map(x, y, pt);
      const o = (y * w + x) * 4;
      const x0 = Math.floor(pt.x), y0 = Math.floor(pt.y);
      if (x0 < -1 || y0 < -1 || x0 >= w || y0 >= h) continue;
      const fx = pt.x - x0, fy = pt.y - y0;
      for (let c = 0; c < 4; c++) {
        const s = (xx, yy) => (xx < 0 || yy < 0 || xx >= w || yy >= h) ? 0 : src[(yy * w + xx) * 4 + c];
        out[o + c] = s(x0, y0) * (1 - fx) * (1 - fy) + s(x0 + 1, y0) * fx * (1 - fy)
                   + s(x0, y0 + 1) * (1 - fx) * fy + s(x0 + 1, y0 + 1) * fx * fy;
      }
    }
  }
  unpremul(data, out);
}

function twirl(data, w, h, angleDeg) {
  const cx = w / 2, cy = h / 2;
  const maxR = Math.min(cx, cy);
  const maxA = angleDeg * Math.PI / 180;
  remapPixels(data, w, h, (x, y, pt) => {
    const vx = x - cx, vy = y - cy;
    const r = Math.hypot(vx, vy) / maxR;
    if (r >= 1) { pt.x = x; pt.y = y; return; }
    const a = maxA * (1 - r) * (1 - r);
    const cs = Math.cos(a), sn = Math.sin(a);
    pt.x = cx + vx * cs - vy * sn;
    pt.y = cy + vx * sn + vy * cs;
  });
}

/* amount > 0 pinches inward, < 0 bulges outward (like CS6 Pinch). */
function pinch(data, w, h, amount) {
  const cx = w / 2, cy = h / 2;
  const maxR = Math.min(cx, cy);
  const k = clamp(amount, -100, 100) / 100;
  remapPixels(data, w, h, (x, y, pt) => {
    const vx = x - cx, vy = y - cy;
    const r = Math.hypot(vx, vy) / maxR;
    if (r >= 1 || r === 0) { pt.x = x; pt.y = y; return; }
    const f = Math.pow(r, 1 + k * (1 - r));
    const scale = f / r;
    pt.x = cx + vx * scale;
    pt.y = cy + vy * scale;
  });
}

function ripple(data, w, h, amount, period) {
  const p = Math.max(4, period);
  remapPixels(data, w, h, (x, y, pt) => {
    pt.x = x + Math.sin(y / p * 2 * Math.PI) * amount;
    pt.y = y + Math.sin(x / p * 2 * Math.PI) * amount;
  });
}
