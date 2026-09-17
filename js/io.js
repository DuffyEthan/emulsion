'use strict';
/* Emulsion I/O. Everything is local: FileReader in, <a download> out.
   Project format (.emulsion): JSON manifest with per-layer PNG data URLs —
   same idea as PSD's layer-and-mask section, in browser materials.
   Real .psd reading/writing lives in js/psd.js; this file just wires it
   into FileReader/Blob like every other format here. */

function openImageFile(file, done) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    const name = file.name.replace(/\.[^.]+$/, '');
    if (!PS.doc) {
      newDocument(img.naturalWidth, img.naturalHeight, 'transparent');
      const L = PS.doc.layers[0];
      L.name = name;
      L.canvas.getContext('2d').drawImage(img, 0, 0);
      PS.projectName = name;
    } else {
      addLayerWithContent(name, (c) => {
        const d = PS.doc;
        const scale = Math.min(1, d.width / img.naturalWidth, d.height / img.naturalHeight);
        const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
        c.drawImage(img, (d.width - w) / 2, (d.height - h) / 2, w, h);
      });
    }
    requestRender();
    if (done) done();
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    if (done) done(new Error('Could not read that file as an image.'));
  };
  img.src = url;
}

function openPSDFile(file, done) {
  const reader = new FileReader();
  reader.onload = () => {
    let psd;
    try {
      psd = parsePSD(reader.result);
    } catch (e) {
      if (done) done(new Error(`Could not read "${file.name}" — it ${e.message || 'is not a readable PSD file'}.`));
      return;
    }
    // Baking adjustment layers (see psdLayersToEmulsion) reuses the real
    // compositor, which reads from PS.doc/PS.tmp*, so the document has to
    // exist at the right size before converting the PSD's layer records.
    newDocument(psd.width, psd.height, 'transparent');
    const d = PS.doc;
    let layers;
    try {
      layers = psdLayersToEmulsion(psd);
    } catch (e) {
      if (done) done(new Error(`Could not read "${file.name}" — it ${e.message || 'is not a readable PSD file'}.`));
      return;
    }
    if (layers.length === 0) {
      const bg = createLayer('Background', psd.width, psd.height, null);
      bg.canvas.getContext('2d').putImageData(new ImageData(psd.merged, psd.width, psd.height), 0, 0);
      d.layers = [bg];
    } else {
      d.layers = layers.map(s => {
        const L = s.adjustment
          ? createAdjustmentLayer(s.adjustment.type, s.adjustment.params)
          : createLayer(s.name, s.canvas.width, s.canvas.height, null);
        L.name = s.name;
        if (!s.adjustment) L.canvas = s.canvas;
        L.mask = s.mask;
        L.x = s.x; L.y = s.y;
        L.opacity = s.opacity;
        L.blendMode = s.blendMode;
        L.visible = s.visible;
        return L;
      });
    }
    d.activeIndex = d.layers.length - 1;
    PS.projectName = file.name.replace(/\.[^.]+$/, '');
    History.reset();
    requestRender();
    if (done) done();
  };
  reader.onerror = () => { if (done) done(new Error(`Could not read "${file.name}".`)); };
  reader.readAsArrayBuffer(file);
}

function exportPSD() {
  const d = PS.doc;
  if (!d) return;
  let buf;
  try {
    buf = buildPSD(d);
  } catch (e) {
    alert('Could not build the PSD file: ' + e.message);
    return;
  }
  const blob = new Blob([buf], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  downloadBlobURL(url, `${PS.projectName}.psd`);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function downloadBlobURL(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function exportImage(type) {
  const d = PS.doc;
  if (!d) return;
  compositeDoc();
  let src = PS.flat;
  if (type === 'image/jpeg') {
    src = mkCanvas(d.width, d.height);
    const c = src.getContext('2d');
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, d.width, d.height);
    c.drawImage(PS.flat, 0, 0);
  }
  const ext = type === 'image/jpeg' ? 'jpg' : 'png';
  downloadBlobURL(src.toDataURL(type, 0.92), `${PS.projectName}.${ext}`);
}

function saveProject() {
  const d = PS.doc;
  if (!d) return;
  const data = {
    app: 'emulsion',
    version: 2,
    width: d.width,
    height: d.height,
    activeIndex: d.activeIndex,
    layers: d.layers.map(L => ({
      name: L.name,
      visible: L.visible,
      opacity: L.opacity,
      blendMode: L.blendMode,
      x: L.x, y: L.y,
      png: isAdjustmentLayer(L) ? null : L.canvas.toDataURL('image/png'),
      mask: L.mask ? L.mask.toDataURL('image/png') : null,
      styles: L.styles || null,
      adjustment: isAdjustmentLayer(L) ? { type: L.adjustment.type, params: L.adjustment.params } : null,
    })),
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  downloadBlobURL(url, `${PS.projectName}.emulsion`);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function loadProject(file, done) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch {
      if (done) done(new Error('That file is not an Emulsion project.'));
      return;
    }
    if (!data || data.app !== 'emulsion' || !Array.isArray(data.layers)) {
      if (done) done(new Error('That file is not an Emulsion project.'));
      return;
    }
    newDocument(data.width, data.height, 'transparent');
    const d = PS.doc;
    d.layers = [];
    PS.projectName = file.name.replace(/\.[^.]+$/, '');
    let remaining = 0;
    const finishOne = () => {
      if (--remaining === 0) {
        d.activeIndex = clamp(data.activeIndex | 0, 0, d.layers.length - 1);
        History.reset();
        requestRender();
        if (done) done();
      }
    };
    data.layers.forEach(s => { remaining += (s.adjustment ? 0 : 1) + (s.mask ? 1 : 0); });
    data.layers.forEach((s, i) => {
      const isAdj = s.adjustment && typeof s.adjustment === 'object';
      const L = isAdj
        ? createAdjustmentLayer(s.adjustment.type, s.adjustment.params)
        : createLayer(s.name || 'Layer', data.width, data.height, null);
      L.name = s.name || L.name;
      L.visible = s.visible !== false;
      L.opacity = typeof s.opacity === 'number' ? s.opacity : 1;
      L.blendMode = s.blendMode || 'normal';
      L.x = s.x | 0; L.y = s.y | 0;
      L.styles = s.styles && typeof s.styles === 'object' ? s.styles : null;
      d.layers[i] = L;
      if (!isAdj) {
        const img = new Image();
        img.onload = () => {
          L.canvas = mkCanvas(img.naturalWidth, img.naturalHeight);
          L.canvas.getContext('2d').drawImage(img, 0, 0);
          finishOne();
        };
        img.onerror = finishOne;
        img.src = s.png;
      }
      if (s.mask) {
        const mimg = new Image();
        mimg.onload = () => {
          L.mask = mkCanvas(mimg.naturalWidth, mimg.naturalHeight);
          L.mask.getContext('2d').drawImage(mimg, 0, 0);
          finishOne();
        };
        mimg.onerror = finishOne;
        mimg.src = s.mask;
      }
    });
    if (data.layers.length > 0 && remaining === 0) {
      // every layer was an adjustment layer with no mask to decode — nothing async to wait on
      d.activeIndex = clamp(data.activeIndex | 0, 0, d.layers.length - 1);
      History.reset();
      requestRender();
      if (done) done();
    }
    if (data.layers.length === 0) {
      d.layers = [createLayer('Background', data.width, data.height, '#ffffff')];
      if (done) done();
    }
  };
  reader.readAsText(file);
}

/* Route any dropped/picked file to the right loader. */
function openAnyFile(file, done) {
  if (/\.emulsion$/i.test(file.name)) loadProject(file, done);
  else if (/\.psd$/i.test(file.name)) openPSDFile(file, done);
  else if (/\.psb$/i.test(file.name)) {
    if (done) done(new Error(`Could not read "${file.name}" — Emulsion only reads standard .psd files, not PSB (Large Document Format). In Photoshop, use File > Save As and choose Photoshop format.`));
  }
  else openImageFile(file, done);
}
