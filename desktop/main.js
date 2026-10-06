'use strict';
/* Emulsion desktop shell (Electron).
   The editor itself is unchanged — this just loads ../index.html in a native
   window, exactly as a browser would via file://. No preload, no Node in the
   page, no network: the "pixels never leave this folder" promise still holds. */

const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');

const isMac = process.platform === 'darwin';
const INDEX = path.join(__dirname, '..', 'index.html');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Emulsion',
    backgroundColor: '#1e1e1e',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Keep the window on the editor: never navigate away (e.g. a stray drop)
  // and send any external links to the user's real browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // The editor's beforeunload handler guards unsaved work. Browsers show a
  // "Leave site?" prompt for that; Electron silently cancels the close
  // instead, so supply the prompt ourselves.
  win.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Close Without Saving', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'You have unsaved changes.',
      detail: 'If you quit now, your edits since the last save will be lost.',
    });
    if (choice === 0) e.preventDefault(); // ignore the page's veto and close
  });

  // Exports use <a download>; Electron shows a native Save dialog for those
  // by default, which is the behaviour we want.

  win.loadFile(INDEX);
  return win;
}

/* ---------- menu ----------
   The editor owns almost every ⌘/Ctrl shortcut (⌘Z undo, ⌘C copy pixels,
   ⌘M Curves, ⌘I Invert, …) and handles them in its own keydown listener.
   Native menu accelerators fire *before* the page sees a key, so the menu
   must not claim those keys — except that on macOS text fields only get
   copy/paste/undo through the Edit menu. So Edit items route the key:
   native editing command if a text field is focused, otherwise forward the
   shortcut to the editor as a keydown. */

const FOCUSED_IS_EDITABLE = `(() => {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
})()`;

function editItem(label, accelerator, nativeCmd, key, shift = false) {
  return {
    label,
    accelerator,
    click: async (_item, win) => {
      if (!win) return;
      const wc = win.webContents;
      let editable = false;
      try { editable = await wc.executeJavaScript(FOCUSED_IS_EDITABLE, true); } catch (_) {}
      if (editable) {
        wc[nativeCmd]();
      } else {
        wc.executeJavaScript(
          `window.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({
            key, metaKey: true, shiftKey: shift, bubbles: true, cancelable: true,
          })}))`, true);
      }
    },
  };
}

function buildMenu() {
  if (!isMac) {
    // Windows/Linux: no menu bar. The editor has its own in-window menus, and
    // Ctrl shortcuts reach the page (and text fields) natively.
    Menu.setApplicationMenu(null);
    return;
  }

  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        editItem('Undo', 'Cmd+Z', 'undo', 'z'),
        editItem('Redo', 'Shift+Cmd+Z', 'redo', 'z', true),
        { type: 'separator' },
        editItem('Cut', 'Cmd+X', 'cut', 'x'),
        editItem('Copy', 'Cmd+C', 'copy', 'c'),
        editItem('Paste', 'Cmd+V', 'paste', 'v'),
        editItem('Select All', 'Cmd+A', 'selectAll', 'a'),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'toggleDevTools' }]),
      ],
    },
    {
      role: 'window',
      submenu: [
        // No ⌘M here: the editor uses ⌘M for Curves.
        { role: 'minimize', accelerator: '' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'close' },
        { role: 'front' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- lifecycle ---------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    app.setAboutPanelOptions({
      applicationName: 'Emulsion',
      applicationVersion: app.getVersion(),
      credits: 'A layered image editor that runs entirely on this machine.',
    });
    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
}
