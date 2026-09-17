'use strict';
/* Renders the interactive overlays (crop shade + free-transform box)
   for a screenshot regression check. */
setTimeout(() => {
  newDocument(800, 500, 'white');
  afterDocChange();
  PS.fg = '#2a6df0';
  selectTool('brush');
  Tools.brush.onDown({ x: 200, y: 200 });
  Tools.brush.onMove({ x: 520, y: 320 });
  Tools.brush.onUp();
  PS.cropRect = { x: 120, y: 90, w: 480, h: 300 };
  beginFreeTransform();
  PS.transform.rot = 0.3;
  PS.transform.sx = 0.8;
  PS.transform.sy = 0.8;
  requestRender();
  setTimeout(() => { console.log('OVERLAY OK'); document.title = 'OVERLAY OK'; }, 250);
}, 300);
