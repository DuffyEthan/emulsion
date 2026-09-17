'use strict';
/* Emulsion PSD codec: reads and writes real Photoshop .psd files, in the
   browser, with no dependencies. Covers the common case Photoshop itself
   writes by default — 8-bit RGB/Grayscale/Indexed/CMYK, RLE (PackBits) or
   raw channel compression, one flat stack of raster layers with blend
   mode/opacity/visibility/position/mask, plus a handful of real
   non-destructive adjustment layers (Threshold/Posterize/Invert — see
   below). Known gaps (documented in README.md): ZIP-compressed channels,
   16/32-bit-per-channel precision, PSB (Large Document Format), layer
   groups (imported flat), fill/type layers and other adjustment-layer
   types (imported as their rendered pixels only, or dropped if they have
   none), layer effects and clipping masks (not round-tripped through
   .psd — use .emulsion for that). */

/* ---------- PSD <-> Emulsion blend mode keys ---------- */

const PSD_BLEND_TO_KEY = {
  normal: 'norm', dissolve: 'diss', darken: 'dark', multiply: 'mul ', 'color-burn': 'idiv',
  'linear-burn': 'lbrn', 'darker-color': 'dkCl', lighten: 'lite', screen: 'scrn', 'color-dodge': 'div ',
  'linear-dodge': 'lddg', 'lighter-color': 'lgCl', overlay: 'over', 'soft-light': 'sLit', 'hard-light': 'hLit',
  'vivid-light': 'vLit', 'linear-light': 'lLit', 'pin-light': 'pLit', 'hard-mix': 'hMix', difference: 'diff',
  exclusion: 'smud', subtract: 'fsub', divide: 'fdiv', hue: 'hue ', saturation: 'sat ', color: 'colr', luminosity: 'lum ',
};
const PSD_BLEND_FROM_KEY = { pass: 'normal' };
for (const k in PSD_BLEND_TO_KEY) PSD_BLEND_FROM_KEY[PSD_BLEND_TO_KEY[k]] = k;

/* ---------- adjustment/fill layers ----------
   Photoshop adjustment layers carry no pixels of their own (their rect is
   0x0) — the effect is a parameter block in additional layer info
   ('thrs', 'post', 'invr', ...) applied live to everything below them.
   Emulsion now has the same concept (js/core.js isAdjustmentLayer, see
   ADJUSTMENT_TYPES in js/adjust.js), so the ones with a simple, fully-
   understood fixed byte layout round-trip as *real*, still-editable
   adjustment layers rather than being flattened. Other adjustment/fill
   layer types (Levels, Curves, Hue/Saturation, Solid Color, ...) use
   Photoshop's generic "Descriptor" structure, which isn't parsed — on
   import those are dropped (no pixels to show); on export, an Emulsion
   adjustment layer of a type this map doesn't cover is baked into a
   rendered layer instead (see buildPSD) so the file still looks right. */
const PSD_ADJUSTMENT_KEY_TO_TYPE = { thrs: 'threshold', post: 'posterize', invr: 'invert' };
const PSD_ADJUSTMENT_TYPE_TO_KEY = {};
for (const k in PSD_ADJUSTMENT_KEY_TO_TYPE) PSD_ADJUSTMENT_TYPE_TO_KEY[PSD_ADJUSTMENT_KEY_TO_TYPE[k]] = k;

/* ---------- byte reader ---------- */

function makePSDReader(buffer) {
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  const r = {
    pos: 0,
    u8() { const v = view.getUint8(r.pos); r.pos += 1; return v; },
    u16() { const v = view.getUint16(r.pos); r.pos += 2; return v; },
    i16() { const v = view.getInt16(r.pos); r.pos += 2; return v; },
    u32() { const v = view.getUint32(r.pos); r.pos += 4; return v; },
    i32() { const v = view.getInt32(r.pos); r.pos += 4; return v; },
    f32() { const v = view.getFloat32(r.pos); r.pos += 4; return v; },
    bytes(n) { const v = u8.slice(r.pos, r.pos + n); r.pos += n; return v; },
    str(n) { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(u8[r.pos + i]); r.pos += n; return s; },
    skip(n) { r.pos += n; },
  };
  return r;
}

/* ---------- byte writer (growable, with backpatchable length fields) ---------- */

function makePSDWriter() {
  let buf = new Uint8Array(4096);
  let pos = 0;
  function ensure(n) {
    if (pos + n <= buf.length) return;
    let cap = buf.length * 2;
    while (cap < pos + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(buf);
    buf = nb;
  }
  const w = {
    u8(v) { ensure(1); buf[pos++] = v & 0xff; },
    u16(v) { ensure(2); buf[pos] = (v >>> 8) & 0xff; buf[pos + 1] = v & 0xff; pos += 2; },
    i16(v) { w.u16(v < 0 ? v + 0x10000 : v); },
    u32(v) { ensure(4); buf[pos] = (v >>> 24) & 0xff; buf[pos + 1] = (v >>> 16) & 0xff; buf[pos + 2] = (v >>> 8) & 0xff; buf[pos + 3] = v & 0xff; pos += 4; },
    i32(v) { w.u32(v < 0 ? v + 0x100000000 : v); },
    bytes(arr) { ensure(arr.length); buf.set(arr, pos); pos += arr.length; },
    str(s) { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff; w.bytes(a); },
    pad(n) { ensure(n); pos += n; },
    u32At(at, v) { buf[at] = (v >>> 24) & 0xff; buf[at + 1] = (v >>> 16) & 0xff; buf[at + 2] = (v >>> 8) & 0xff; buf[at + 3] = v & 0xff; },
    reserveU32() { const at = pos; w.u32(0); return at; },
    here() { return pos; },
    finish() { return buf.buffer.slice(0, pos); },
  };
  return w;
}

/* ---------- PackBits (RLE) ---------- */

function unpackBitsInto(src, out, outLen) {
  let si = 0, oi = 0;
  while (oi < outLen && si < src.length) {
    const n = src[si++];
    if (n <= 127) {
      const cnt = n + 1;
      out.set(src.subarray(si, si + cnt), oi);
      si += cnt; oi += cnt;
    } else if (n !== 128) {
      const cnt = 257 - n;
      const v = src[si++];
      out.fill(v, oi, oi + cnt);
      oi += cnt;
    }
  }
  return out;
}

function packBitsRow(row) {
  const out = [];
  const n = row.length;
  let i = 0;
  while (i < n) {
    let runLen = 1;
    while (i + runLen < n && runLen < 128 && row[i + runLen] === row[i]) runLen++;
    if (runLen >= 2) {
      out.push(257 - runLen, row[i]);
      i += runLen;
    } else {
      const litStart = i;
      let litLen = 1;
      i++;
      while (i < n && litLen < 128) {
        let rl = 1;
        while (i + rl < n && rl < 128 && row[i + rl] === row[i]) rl++;
        if (rl >= 2) break;
        litLen++; i++;
      }
      out.push(litLen - 1);
      for (let k = 0; k < litLen; k++) out.push(row[litStart + k]);
    }
  }
  return Uint8Array.from(out);
}

/* ---------- reading ---------- */

function psdSampleAt(bytes, i, depth) {
  if (!bytes) return 0;
  if (depth === 16) { const v = (bytes[i * 2] << 8) | bytes[i * 2 + 1]; return Math.round(v / 257); }
  if (depth === 32) {
    const v = new DataView(bytes.buffer, bytes.byteOffset + i * 4, 4).getFloat32(0, false);
    return Math.round(Math.max(0, Math.min(1, v)) * 255);
  }
  return bytes[i];
}

function bytesPerSample(depth) { return depth === 16 ? 2 : depth === 32 ? 4 : 1; }

function readChannelSamples(r, w, h, depth) {
  const compression = r.u16();
  const bpp = bytesPerSample(depth);
  if (w === 0 || h === 0) return new Uint8Array(0);
  if (compression === 0) {
    return r.bytes(w * h * bpp);
  } else if (compression === 1) {
    const rowCounts = new Array(h);
    for (let y = 0; y < h; y++) rowCounts[y] = r.u16();
    const out = new Uint8Array(w * h * bpp);
    let off = 0;
    for (let y = 0; y < h; y++) {
      const packed = r.bytes(rowCounts[y]);
      unpackBitsInto(packed, out.subarray(off, off + w * bpp), w * bpp);
      off += w * bpp;
    }
    return out;
  }
  throw new Error('uses ZIP-compressed image data, which Emulsion cannot read — in Photoshop, use File > Save As with compression set to RLE (not Zip), or File > Export > Layers to Files, then reopen.');
}

/* chans: {0,1,2,3: Uint8Array samples, alpha: Uint8Array|undefined} -> Uint8ClampedArray RGBA */
function composeRGBA(colorMode, chans, w, h, depth, palette) {
  const n = w * h;
  const out = new Uint8ClampedArray(n * 4);
  const mode = colorMode === 8 ? 1 : colorMode; // duotone reads as grayscale
  for (let i = 0; i < n; i++) {
    let r, g, b;
    const a = chans.alpha ? psdSampleAt(chans.alpha, i, depth) : 255;
    if (mode === 1) {
      r = g = b = psdSampleAt(chans[0], i, depth);
    } else if (mode === 2) {
      const idx = psdSampleAt(chans[0], i, depth);
      r = palette[idx]; g = palette[256 + idx]; b = palette[512 + idx];
    } else if (mode === 4) {
      const c = 255 - psdSampleAt(chans[0], i, depth), m = 255 - psdSampleAt(chans[1], i, depth),
            y = 255 - psdSampleAt(chans[2], i, depth), k = 255 - psdSampleAt(chans[3], i, depth);
      r = 255 - Math.min(255, c + k); g = 255 - Math.min(255, m + k); b = 255 - Math.min(255, y + k);
    } else {
      r = psdSampleAt(chans[0], i, depth); g = psdSampleAt(chans[1], i, depth); b = psdSampleAt(chans[2], i, depth);
    }
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a;
  }
  return out;
}

function readAdditionalInfoBlock(r, endPos, rec) {
  while (r.pos < endPos - 7) {
    const sig = r.str(4);
    if (sig !== '8BIM' && sig !== '8B64') { r.pos = endPos; return; }
    const key = r.str(4);
    let len = r.u32();
    const start = r.pos;
    if (key === 'luni') {
      const count = r.u32();
      let s = '';
      for (let i = 0; i < count; i++) s += String.fromCharCode(r.u16());
      rec.name = s.replace(/ +$/, '');
    } else if (key === 'lsct') {
      rec.sectionType = r.u32();
    } else if (key === 'thrs' && len >= 2) {
      rec.adjustment = { key: 'thrs', value: r.u16() };
    } else if (key === 'post' && len >= 2) {
      rec.adjustment = { key: 'post', value: r.u16() };
    } else if (key === 'invr') {
      rec.adjustment = { key: 'invr', value: null };
    }
    r.pos = start + len;
    if (len % 2 !== 0) r.pos += 1;
  }
  r.pos = endPos;
}

function readLayerRecord(r) {
  const rec = {};
  rec.top = r.i32(); rec.left = r.i32(); rec.bottom = r.i32(); rec.right = r.i32();
  const numChannels = r.u16();
  rec.channels = [];
  for (let i = 0; i < numChannels; i++) rec.channels.push({ id: r.i16(), len: r.u32() });
  r.skip(4); // '8BIM'
  rec.blendKey = r.str(4);
  rec.opacity = r.u8();
  rec.clipping = r.u8();
  rec.flags = r.u8();
  r.skip(1); // filler
  const extraLen = r.u32();
  const extraEnd = r.pos + extraLen;

  const maskLen = r.u32();
  const maskStart = r.pos;
  rec.mask = null;
  if (maskLen > 0) {
    const top = r.i32(), left = r.i32(), bottom = r.i32(), right = r.i32();
    const defaultColor = r.u8();
    const flags = r.u8();
    rec.mask = { top, left, bottom, right, defaultColor, flags };
  }
  r.pos = maskStart + maskLen;

  const blendRangesLen = r.u32();
  r.skip(blendRangesLen);

  const nameLen = r.u8();
  rec.name = r.str(nameLen);
  const consumed = 1 + nameLen;
  r.skip((4 - (consumed % 4)) % 4);

  readAdditionalInfoBlock(r, extraEnd, rec);
  r.pos = extraEnd;
  return rec;
}

function parsePSD(buffer) {
  const r = makePSDReader(buffer);
  if (r.str(4) !== '8BPS') throw new Error('not a Photoshop file (missing "8BPS" signature)');
  const version = r.u16();
  if (version === 2) throw new Error('is a PSB (Large Document Format) file — Emulsion only reads standard .psd; in Photoshop use File > Save As and choose Photoshop format instead of Large Document Format');
  if (version !== 1) throw new Error('has an unrecognized PSD version');
  r.skip(6);
  const channels = r.u16();
  const height = r.u32();
  const width = r.u32();
  const depth = r.u16();
  const colorMode = r.u16();
  if (depth === 1) throw new Error('is a Bitmap-mode image — in Photoshop, convert Image > Mode to Grayscale or RGB and re-save');
  if (![1, 2, 3, 4, 8].includes(colorMode)) throw new Error('uses a color mode Emulsion cannot read (Lab/Multichannel) — convert Image > Mode to RGB in Photoshop and re-save');

  const colorModeDataLen = r.u32();
  let palette = null;
  if (colorMode === 2 && colorModeDataLen >= 768) {
    palette = r.bytes(768);
    r.skip(colorModeDataLen - 768);
  } else {
    r.skip(colorModeDataLen);
  }

  const resourcesLen = r.u32();
  r.skip(resourcesLen);

  const layerMaskLen = r.u32();
  const layerMaskEnd = r.pos + layerMaskLen;
  const records = [];
  if (layerMaskLen > 0) {
    const layerInfoLen = r.u32();
    const layerInfoEnd = r.pos + layerInfoLen;
    if (layerInfoLen > 0) {
      const layerCount = Math.abs(r.i16());
      for (let i = 0; i < layerCount; i++) records.push(readLayerRecord(r));
      for (const rec of records) {
        rec.channelData = {};
        for (const ch of rec.channels) {
          let w, h;
          if (ch.id === -2 && rec.mask) { w = rec.mask.right - rec.mask.left; h = rec.mask.bottom - rec.mask.top; }
          else { w = rec.right - rec.left; h = rec.bottom - rec.top; }
          rec.channelData[ch.id] = readChannelSamples(r, w, h, depth);
        }
      }
    }
    r.pos = layerInfoEnd;
  }
  r.pos = layerMaskEnd;

  const compression = r.u16();
  const bpp = bytesPerSample(depth);
  let mergedRaw;
  if (compression === 0) {
    mergedRaw = [];
    for (let c = 0; c < channels; c++) mergedRaw.push(r.bytes(width * height * bpp));
  } else if (compression === 1) {
    const rowCounts = [];
    for (let c = 0; c < channels; c++) {
      const arr = new Array(height);
      for (let y = 0; y < height; y++) arr[y] = r.u16();
      rowCounts.push(arr);
    }
    mergedRaw = [];
    for (let c = 0; c < channels; c++) {
      const out = new Uint8Array(width * height * bpp);
      let off = 0;
      for (let y = 0; y < height; y++) {
        const packed = r.bytes(rowCounts[c][y]);
        unpackBitsInto(packed, out.subarray(off, off + width * bpp), width * bpp);
        off += width * bpp;
      }
      mergedRaw.push(out);
    }
  } else {
    throw new Error('uses ZIP-compressed image data, which Emulsion cannot read — in Photoshop, re-save with compression set to RLE');
  }

  const mergedChans = {};
  const mode = colorMode === 8 ? 1 : colorMode;
  if (mode === 4) {
    mergedChans[0] = mergedRaw[0]; mergedChans[1] = mergedRaw[1]; mergedChans[2] = mergedRaw[2]; mergedChans[3] = mergedRaw[3];
    if (mergedRaw[4]) mergedChans.alpha = mergedRaw[4];
  } else if (mode === 1 || mode === 2) {
    mergedChans[0] = mergedRaw[0];
    if (mergedRaw[1]) mergedChans.alpha = mergedRaw[1];
  } else {
    mergedChans[0] = mergedRaw[0]; mergedChans[1] = mergedRaw[1]; mergedChans[2] = mergedRaw[2];
    if (mergedRaw[3]) mergedChans.alpha = mergedRaw[3];
  }
  const merged = composeRGBA(colorMode, mergedChans, width, height, depth, palette);

  return { width, height, depth, colorMode, palette, layers: records, merged };
}

/* ---------- PSD layer records -> Emulsion layer descriptors ---------- */

/* A layer mask's own rect is independent of its layer's rect (notably for
   an adjustment layer, whose own rect is always 0x0) — decode it against
   whatever target canvas size/origin the caller's layer actually uses. */
function decodePsdMask(rec, psd, targetW, targetH, originLeft, originTop) {
  const maskSamples = rec.channelData[-2];
  if (!rec.mask || !maskSamples) return null;
  const mw = rec.mask.right - rec.mask.left, mh = rec.mask.bottom - rec.mask.top;
  if (mw <= 0 || mh <= 0) return null;
  const grayRGBA = new Uint8ClampedArray(mw * mh * 4);
  for (let i = 0; i < mw * mh; i++) {
    const v = psdSampleAt(maskSamples, i, psd.depth);
    grayRGBA[i * 4] = v; grayRGBA[i * 4 + 1] = v; grayRGBA[i * 4 + 2] = v; grayRGBA[i * 4 + 3] = 255;
  }
  const tmp = mkCanvas(mw, mh);
  tmp.getContext('2d').putImageData(new ImageData(grayRGBA, mw, mh), 0, 0);
  const mask = mkCanvas(targetW, targetH);
  const mctx = mask.getContext('2d');
  mctx.fillStyle = (rec.mask.defaultColor || 0) >= 128 ? '#fff' : '#000';
  mctx.fillRect(0, 0, targetW, targetH);
  mctx.drawImage(tmp, rec.mask.left - originLeft, rec.mask.top - originTop);
  return mask;
}

function psdLayersToEmulsion(psd) {
  const out = [];
  for (const rec of psd.layers) {
    if (rec.adjustment) {
      const type = PSD_ADJUSTMENT_KEY_TO_TYPE[rec.adjustment.key];
      if (!type) continue; // unsupported adjustment/fill layer (Descriptor-based): no pixels to show
      const value = rec.adjustment.value;
      const params = type === 'threshold' ? { level: value }
        : type === 'posterize' ? { levels: value }
        : structuredClone(ADJUSTMENT_TYPES[type].defaults);
      out.push({
        name: rec.name || ADJUSTMENT_TYPES[type].label,
        x: 0, y: 0,
        opacity: rec.opacity / 255,
        blendMode: PSD_BLEND_FROM_KEY[rec.blendKey] || 'normal',
        visible: !(rec.flags & 2),
        canvas: null,
        mask: decodePsdMask(rec, psd, psd.width, psd.height, 0, 0),
        adjustment: { type, params },
      });
      continue;
    }
    const w = rec.right - rec.left, h = rec.bottom - rec.top;
    if (w <= 0 || h <= 0) continue; // group divider: nothing to raster
    const chans = {};
    for (const id in rec.channelData) {
      const n = +id;
      if (n === -1) chans.alpha = rec.channelData[n];
      else if (n >= 0) chans[n] = rec.channelData[n];
    }
    const rgba = composeRGBA(psd.colorMode, chans, w, h, psd.depth, psd.palette);
    const canvas = mkCanvas(w, h);
    canvas.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);

    out.push({
      name: rec.name || 'Layer',
      x: rec.left, y: rec.top,
      opacity: rec.opacity / 255,
      blendMode: PSD_BLEND_FROM_KEY[rec.blendKey] || 'normal',
      visible: !(rec.flags & 2),
      canvas,
      mask: decodePsdMask(rec, psd, w, h, rec.left, rec.top),
    });
  }
  return out;
}

/* ---------- Emulsion document -> PSD bytes ---------- */

function splitLayerChannels(canvas) {
  const w = canvas.width, h = canvas.height;
  const data = ctx2d(canvas).getImageData(0, 0, w, h).data;
  const n = w * h;
  const R = new Uint8Array(n), G = new Uint8Array(n), B = new Uint8Array(n), A = new Uint8Array(n);
  for (let i = 0; i < n; i++) { R[i] = data[i * 4]; G[i] = data[i * 4 + 1]; B[i] = data[i * 4 + 2]; A[i] = data[i * 4 + 3]; }
  return { R, G, B, A };
}

function encodeChannelRLE(samples, w, h) {
  const cw = makePSDWriter();
  cw.u16(1);
  const rows = new Array(h);
  for (let y = 0; y < h; y++) rows[y] = packBitsRow(samples.subarray(y * w, y * w + w));
  for (const row of rows) cw.u16(row.length);
  for (const row of rows) cw.bytes(row);
  return new Uint8Array(cw.finish());
}

function encodeLayerForPSD(L) {
  const w = L.canvas.width, h = L.canvas.height;
  const { R, G, B, A } = splitLayerChannels(L.canvas);
  const channels = [
    { id: 0, buf: encodeChannelRLE(R, w, h) },
    { id: 1, buf: encodeChannelRLE(G, w, h) },
    { id: 2, buf: encodeChannelRLE(B, w, h) },
    { id: -1, buf: encodeChannelRLE(A, w, h) },
  ];
  if (L.mask) {
    const mdata = ctx2d(L.mask).getImageData(0, 0, w, h).data;
    const M = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) M[i] = mdata[i * 4];
    channels.push({ id: -2, buf: encodeChannelRLE(M, w, h) });
  }
  return { L, w, h, channels };
}

function writeLuniBlock(w, name) {
  const dw = makePSDWriter();
  dw.u32(name.length);
  for (let i = 0; i < name.length; i++) dw.u16(name.charCodeAt(i));
  const buf = new Uint8Array(dw.finish());
  w.str('8BIM'); w.str('luni'); w.u32(buf.length); w.bytes(buf);
  if (buf.length % 2 !== 0) w.pad(1);
}

/* A supported adjustment layer (Threshold/Posterize/Invert) exports as a
   real 0x0 PSD adjustment layer record — Photoshop will re-open it as a
   live, still-editable adjustment layer, same as it would one it wrote
   itself. Its channels carry no pixel data (see the compression-only
   2-byte buffers below, mirroring what parsePSD's readChannelSamples
   expects for a 0x0 rect); its mask, if any, is doc-sized. */
function encodeAdjustmentLayerForPSD(L) {
  const channels = [0, 1, 2, -1].map(id => ({ id, buf: new Uint8Array([0, 0]) }));
  if (L.mask) {
    const mw = L.mask.width, mh = L.mask.height;
    const mdata = ctx2d(L.mask).getImageData(0, 0, mw, mh).data;
    const M = new Uint8Array(mw * mh);
    for (let i = 0; i < mw * mh; i++) M[i] = mdata[i * 4];
    channels.push({ id: -2, buf: encodeChannelRLE(M, mw, mh) });
  }
  return { L, w: 0, h: 0, channels, isAdjustment: true };
}

function writeAdjustmentInfoBlock(w, adjustment) {
  const key = PSD_ADJUSTMENT_TYPE_TO_KEY[adjustment.type];
  w.str('8BIM'); w.str(key);
  if (key === 'thrs') { w.u32(2); w.u16(Math.max(1, Math.min(255, Math.round(adjustment.params.level)))); }
  else if (key === 'post') { w.u32(2); w.u16(Math.max(2, Math.min(255, Math.round(adjustment.params.levels)))); }
  else w.u32(0); // invr: no data
}

/* An adjustment layer type this codec can't write as a real PSD
   adjustment record (Levels, Curves, Hue/Saturation, ...) is baked into a
   rendered layer instead — reusing the live compositor (compositeLayerOnto
   already knows how to render an adjustment layer's effect, mask, opacity
   and blend mode) so the exported file still looks right; the layers
   underneath stay in the file, just visually covered by this opaque
   result, exactly as they'd be under any other opaque layer. */
function bakeAdjustmentForExport(d, L) {
  const idx = d.layers.indexOf(L);
  const canvas = mkCanvas(d.width, d.height);
  const ctx = ctx2d(canvas);
  for (let i = 0; i < idx; i++) { if (d.layers[i].visible) compositeLayerOnto(ctx, d.layers[i], false); }
  compositeLayerOnto(ctx, L, false);
  return { name: L.name, x: 0, y: 0, canvas, mask: null, opacity: 1, blendMode: 'normal', visible: true };
}

function writeMergedImageRLE(w, canvas, width, height) {
  const data = ctx2d(canvas).getImageData(0, 0, width, height).data;
  const n = width * height;
  const R = new Uint8Array(n), G = new Uint8Array(n), B = new Uint8Array(n), A = new Uint8Array(n);
  for (let i = 0; i < n; i++) { R[i] = data[i * 4]; G[i] = data[i * 4 + 1]; B[i] = data[i * 4 + 2]; A[i] = data[i * 4 + 3]; }
  w.u16(1);
  const chans = [R, G, B, A].map(ch => {
    const rows = new Array(height);
    for (let y = 0; y < height; y++) rows[y] = packBitsRow(ch.subarray(y * width, y * width + width));
    return rows;
  });
  for (const rows of chans) for (const row of rows) w.u16(row.length);
  for (const rows of chans) for (const row of rows) w.bytes(row);
}

function buildPSD(d) {
  compositeDoc();
  const encoded = d.layers.map(L => {
    if (!isAdjustmentLayer(L)) return encodeLayerForPSD(L);
    return PSD_ADJUSTMENT_TYPE_TO_KEY[L.adjustment.type]
      ? encodeAdjustmentLayerForPSD(L)
      : encodeLayerForPSD(bakeAdjustmentForExport(d, L));
  });

  const w = makePSDWriter();
  w.str('8BPS'); w.u16(1); w.pad(6);
  w.u16(4); w.u32(d.height); w.u32(d.width); w.u16(8); w.u16(3);
  w.u32(0); // color mode data
  w.u32(0); // image resources

  const lmAt = w.reserveU32();
  const lmStart = w.here();
  const liAt = w.reserveU32();
  const liStart = w.here();
  w.i16(encoded.length);

  for (const e of encoded) {
    const L = e.L;
    w.i32(L.y); w.i32(L.x); w.i32(L.y + e.h); w.i32(L.x + e.w);
    w.u16(e.channels.length);
    for (const ch of e.channels) { w.i16(ch.id); w.u32(ch.buf.byteLength); }
    w.str('8BIM');
    w.str(PSD_BLEND_TO_KEY[L.blendMode] || 'norm');
    w.u8(Math.round(Math.max(0, Math.min(1, L.opacity)) * 255));
    w.u8(0); // clipping: base
    w.u8(L.visible ? 0 : 2); // flags
    w.u8(0); // filler
    const extraAt = w.reserveU32();
    const extraStart = w.here();
    if (L.mask) {
      // An adjustment layer's own rect is 0x0, but its mask is always
      // doc-sized (see createAdjustmentLayer/addLayerMask in core.js) —
      // the mask sub-block's rect describes the mask, not the layer.
      const mr = e.isAdjustment ? { t: 0, l: 0, b: d.height, r: d.width } : { t: L.y, l: L.x, b: L.y + e.h, r: L.x + e.w };
      w.u32(20);
      w.i32(mr.t); w.i32(mr.l); w.i32(mr.b); w.i32(mr.r);
      w.u8(0); w.u8(0); w.pad(2);
    } else {
      w.u32(0);
    }
    w.u32(0); // layer blending ranges
    const nm = (L.name || 'Layer').replace(/[^\x00-\x7f]/g, '?').slice(0, 255);
    w.u8(nm.length);
    w.str(nm);
    const consumed = 1 + nm.length;
    w.pad((4 - (consumed % 4)) % 4);
    writeLuniBlock(w, L.name || 'Layer');
    if (e.isAdjustment) writeAdjustmentInfoBlock(w, L.adjustment);
    w.u32At(extraAt, w.here() - extraStart);
  }
  // Channel image data for each channel carries its own 2-byte compression
  // marker (already included in encodeChannelRLE's output).
  for (const e of encoded) for (const ch of e.channels) w.bytes(ch.buf);

  w.u32At(liAt, w.here() - liStart);
  w.u32(0); // global layer mask info
  w.u32At(lmAt, w.here() - lmStart);

  writeMergedImageRLE(w, PS.flat, d.width, d.height);
  return w.finish();
}
