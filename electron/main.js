const { app, BrowserWindow, ipcMain, protocol, session, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { printStrip, listPrinters, testPrint } = require('./print');
const {
  listAlbum,
  getAlbumPngBase64,
  addAlbumEntry,
  removeAlbumEntry,
  clearAlbum,
} = require('./album-store');
const { captureStill, probeCameraBackend, normalizeCameraConfig, startDigiCamLiveView, stopDigiCamLiveView } = require('./camera-capture');
const { fetchGphotoPreview } = require('./gphoto-capture');

/** Serialize all WSL gphoto2 calls (preview + shutter) — Fuji USB allows one client. */
let gphotoChain = Promise.resolve();

function runGphotoExclusive(task) {
  const next = gphotoChain.then(() => task());
  gphotoChain = next.catch(() => {});
  return next;
}

// Keep Chromium UI / media prompts in English (does not change Windows OS language)
app.commandLine.appendSwitch('lang', 'en-US');

const isDev = !app.isPackaged;
let mainWindow = null;

function getAppRoot() {
  if (isDev) return path.join(__dirname, '..');
  return path.dirname(app.getPath('exe'));
}

function getConfigPath() {
  const userConfig = path.join(app.getPath('userData'), 'config.json');
  if (fs.existsSync(userConfig)) return userConfig;
  if (isDev) return path.join(getAppRoot(), 'config.json');
  const resourceConfig = path.join(process.resourcesPath, 'config.json');
  if (fs.existsSync(resourceConfig)) return resourceConfig;
  return path.join(getAppRoot(), 'config.json');
}

function getAssetsRoot() {
  if (isDev) return path.join(getAppRoot(), 'assets');
  const fromResources = path.join(process.resourcesPath, 'assets');
  if (fs.existsSync(fromResources)) return fromResources;
  return path.join(getAppRoot(), 'assets');
}

function getOutputDir(cfg) {
  const dirName = (cfg && cfg.outputDir) || 'output';
  const dir = path.isAbsolute(dirName)
    ? dirName
    : path.join(app.getPath('userData'), dirName);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getLogDir() {
  const dir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function appendLog(line) {
  const file = path.join(getLogDir(), 'photobooth.log');
  const stamp = new Date().toISOString();
  fs.appendFileSync(file, `[${stamp}] ${line}\n`, 'utf8');
}

function readConfig() {
  const configPath = getConfigPath();
  const raw = fs.readFileSync(configPath, 'utf8');
  return { config: JSON.parse(raw), configPath };
}

function writeConfig(next) {
  const configPath = getConfigPath();
  // Prefer writable userData copy in production
  const target = isDev
    ? configPath
    : path.join(app.getPath('userData'), 'config.json');
  fs.writeFileSync(target, JSON.stringify(next, null, 2), 'utf8');
  return target;
}

function resolvePathFromConfig(rel) {
  if (!rel) return null;
  if (path.isAbsolute(rel) && fs.existsSync(rel)) return rel;
  const candidates = [
    path.join(getAppRoot(), rel),
    path.join(process.resourcesPath || '', rel),
    path.join(getAssetsRoot(), 'templates', path.basename(rel)),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return path.join(getAppRoot(), rel);
}

function resolveTemplatePath(cfg, templateId) {
  const templates = cfg.templates || [];
  let t =
    (templateId && templates.find((x) => x.id === templateId)) ||
    templates.find((x) => x.id === cfg.defaults?.templateId) ||
    templates[0];
  if (t?.path) return resolvePathFromConfig(t.path);
  return resolvePathFromConfig(cfg.templatePath || 'assets/templates/strip-blank.png');
}

function enrichConfig(config) {
  const templates = (config.templates || []).map((t) => ({
    ...t,
    _absPath: resolvePathFromConfig(t.path),
    _exists: fs.existsSync(resolvePathFromConfig(t.path)),
  }));
  return { ...config, templates };
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1280, width),
    height: Math.min(900, height),
    show: false,
    fullscreen: false,
    autoHideMenuBar: true,
    backgroundColor: '#060d18',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const allowed =
      url.startsWith('http://127.0.0.1:5173') ||
      url.startsWith('http://localhost:5173') ||
      url.startsWith('file://');
    if (!allowed) e.preventDefault();
  });

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173/').catch(() => {
      mainWindow.loadURL('http://localhost:5173/');
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpc() {
  ipcMain.handle('config:get', async () => {
    const { config, configPath } = readConfig();
    const enriched = enrichConfig(config);
    const templateAbs = resolveTemplatePath(config);
    const printers = await listPrinters();
    return {
      config: enriched,
      configPath,
      templateAbs,
      templateExists: fs.existsSync(templateAbs),
      printers,
      printerOk: printers.some((p) => p.name === config.printerName),
      printerWarning: !printers.some((p) => p.name === config.printerName)
        ? `Configured printer "${config.printerName}" was not found.`
        : null,
      isDev,
      outputDir: getOutputDir(config),
      logDir: getLogDir(),
      albumDir: path.join(app.getPath('userData'), 'album'),
    };
  });

  ipcMain.handle('album:list', async () => listAlbum(app.getPath('userData')));

  ipcMain.handle('album:get-png', async (_e, id) => {
    return getAlbumPngBase64(app.getPath('userData'), id);
  });

  ipcMain.handle('album:add', async (_e, entry) => {
    try {
      const result = addAlbumEntry(app.getPath('userData'), entry);
      appendLog(`Album saved ${result.item.id} (${result.count} items)`);
      return { ok: true, ...result };
    } catch (err) {
      appendLog(`Album save FAIL: ${err.message}`);
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('album:remove', async (_e, id) => {
    const count = removeAlbumEntry(app.getPath('userData'), id);
    appendLog(`Album removed ${id} (${count} items)`);
    return { ok: true, count };
  });

  ipcMain.handle('album:clear', async () => {
    const dir = clearAlbum(app.getPath('userData'));
    appendLog(`Album cleared → ${dir}`);
    return { ok: true, dir };
  });

  ipcMain.handle('template:resolve', async (_e, templateId) => {
    const { config } = readConfig();
    const abs = resolveTemplatePath(config, templateId);
    if (!fs.existsSync(abs)) throw new Error(`Template not found: ${templateId}`);
    const buf = fs.readFileSync(abs);
    return `data:image/png;base64,${buf.toString('base64')}`;
  });
  ipcMain.handle('config:save', async (_e, next) => {
    const savedPath = writeConfig(next);
    appendLog(`Config saved → ${savedPath}`);
    return { ok: true, path: savedPath };
  });

  ipcMain.handle('printers:list', async () => listPrinters());

  ipcMain.handle('print:strip', async (_e, payload) => {
    const { config } = readConfig();
    try {
      const result = await printStrip({
        pngBase64: payload.pngBase64,
        printerName: payload.printerName || config.printerName,
        copies: payload.copies ?? config.copies ?? 1,
        dpi: config.canvas?.dpi || 300,
        widthPx: payload.widthPx,
        heightPx: payload.heightPx,
        pageWidthIn: payload.pageWidthIn,
        pageHeightIn: payload.pageHeightIn,
        mainWindow,
      });
      appendLog(`Print OK printer="${result.printerName}" copies=${result.copies}`);
      return { ok: true, ...result };
    } catch (err) {
      appendLog(`Print FAIL: ${err.message}`);
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('print:test', async (_e, payload) => {
    const { config } = readConfig();
    try {
      const result = await testPrint({
        printerName: payload?.printerName || config.printerName,
        copies: 1,
        templatePath: resolveTemplatePath(config),
        underfillColor: config.underfillColor || '#1a1408',
        width: (config.canvas?.width || 600) * (config.canvas?.scale || 1),
        height: (config.canvas?.height || 1800) * (config.canvas?.scale || 1),
        dpi: config.canvas?.dpi || 300,
        mainWindow,
      });
      appendLog(`Test print OK printer="${result.printerName}"`);
      return { ok: true, ...result };
    } catch (err) {
      appendLog(`Test print FAIL: ${err.message}`);
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('fs:save-png', async (_e, payload) => {
    const { config } = readConfig();
    const outDir = getOutputDir(config);
    const name = payload.filename || `strip-${Date.now()}.png`;
    const dest = path.join(outDir, name);
    const buf = Buffer.from(payload.pngBase64, 'base64');
    fs.writeFileSync(dest, buf);
    appendLog(`Saved PNG ${dest}`);
    return { ok: true, path: dest };
  });

  ipcMain.handle('fs:read-file-dataurl', async (_e, absPath) => {
    if (!absPath || !fs.existsSync(absPath)) {
      throw new Error(`File not found: ${absPath}`);
    }
    const buf = fs.readFileSync(absPath);
    const ext = path.extname(absPath).toLowerCase();
    const mime =
      ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.webp'
          ? 'image/webp'
          : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  });

  ipcMain.handle('app:toggle-fullscreen', async () => {
    if (!mainWindow) return false;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return mainWindow.isFullScreen();
  });

  ipcMain.handle('app:set-fullscreen', async (_e, on) => {
    if (!mainWindow) return false;
    mainWindow.setFullScreen(!!on);
    return mainWindow.isFullScreen();
  });

  ipcMain.handle('log:write', async (_e, message) => {
    appendLog(String(message));
    return { ok: true };
  });

  ipcMain.handle('camera:probe', async () => {
    const { config } = readConfig();
    return probeCameraBackend(config.camera || {}, app.getPath('userData'));
  });

  ipcMain.handle('camera:capture', async () => {
    const { config } = readConfig();
    const camera = normalizeCameraConfig(config.camera || {});
    return runGphotoExclusive(async () => {
      try {
        const result = await captureStill(camera, {
          appUserData: app.getPath('userData'),
          log: appendLog,
        });
        return result;
      } catch (err) {
        appendLog(`Camera capture FAIL: ${err.message}`);
        return {
          ok: false,
          error: err.message || String(err),
          fallbackToWebcam: camera.fallbackToWebcam,
        };
      }
    });
  });

  ipcMain.handle('camera:gphoto-preview', async () => {
    const { config } = readConfig();
    const camera = normalizeCameraConfig(config.camera || {});
    if (camera.backend !== 'gphoto2') return { ok: false, reason: 'not-gphoto2' };
    return runGphotoExclusive(async () => {
      try {
        return await fetchGphotoPreview(camera, appendLog);
      } catch (err) {
        return { ok: false, error: err.message };
      }
    });
  });

  ipcMain.handle('camera:liveview-start', async () => {
    const { config } = readConfig();
    const camera = normalizeCameraConfig(config.camera || {});
    if (camera.previewSource !== 'digicamcontrol' || camera.backend !== 'digicamcontrol') {
      return { ok: false, reason: 'not-digicamcontrol-preview' };
    }
    try {
      const info = await startDigiCamLiveView(camera);
      return { ok: true, ...info };
    } catch (err) {
      appendLog(`Live view start FAIL: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('camera:liveview-stop', async () => {
    const { config } = readConfig();
    const camera = normalizeCameraConfig(config.camera || {});
    try {
      await stopDigiCamLiveView(camera);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

app.whenReady().then(() => {
  // Allow camera; media permissions for getUserMedia
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media' || permission === 'mediaKeySystem') {
      callback(true);
      return;
    }
    callback(false);
  });

  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
