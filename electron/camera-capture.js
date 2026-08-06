/**
 * Sony / DSLR capture via digiCamControl (real shutter → JPEG/RAW files).
 * Avoids grabbing live-view frames that bake in camera OSD overlays.
 *
 * Sony α5000: digiCamControl supports this model over Wi‑Fi only (Smart Remote Control),
 * not USB PC Remote. See probeCameraBackend() hints.
 */

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { promisify } = require('util');
const { probeGphoto, captureViaGphoto, FUJI_HINT } = require('./gphoto-capture');

const execFileAsync = promisify(execFile);

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.arw', '.raf', '.raw', '.dng']);
const PREFER_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

const SONY_WIFI_HINT =
  'Sony α5000 in digiCamControl: Wi‑Fi only (not USB). On camera: Menu → Application → Smart Remote Control. ' +
  'Connect the PC to the camera Wi‑Fi (SSID/password on camera screen). In digiCamControl: Wi‑Fi button (top) → Sony device. ' +
  'Use mode Remote with digiCamControl running. Enable Settings → Webserver if remote capture fails.';

const DEFAULT_CMD_CANDIDATES = [
  path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'digiCamControl', 'CameraControlCmd.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'digiCamControl', 'CameraControlCmd.exe'),
];

const DEFAULT_REMOTE_CANDIDATES = [
  path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'digiCamControl', 'CameraControlRemoteCmd.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'digiCamControl', 'CameraControlRemoteCmd.exe'),
];

function normalizeCameraConfig(camera = {}) {
  const mode = camera.mode === 'http' ? 'http' : camera.mode === 'remote' ? 'remote' : 'cmd';
  let backend = 'webcam';
  if (camera.backend === 'digicamcontrol') backend = 'digicamcontrol';
  else if (camera.backend === 'gphoto2') backend = 'gphoto2';
  else if (camera.backend === 'capture-card') backend = 'capture-card';
  const previewSource =
    camera.previewSource === 'digicamcontrol'
      ? 'digicamcontrol'
      : camera.previewSource === 'capture-card'
        ? 'capture-card'
        : 'webcam';
  return {
    backend,
    mode,
    previewSource,
    cmdPath: camera.cmdPath || '',
    remoteCmdPath: camera.remoteCmdPath || '',
    gphotoPath: camera.gphotoPath || '',
    useWslGphoto: camera.useWslGphoto !== false,
    webPort: Math.max(1, Number(camera.webPort) || 5513),
    watchFolder: camera.watchFolder || '',
    archiveFolder: camera.archiveFolder || '',
    timeoutMs: Math.max(5000, Number(camera.timeoutMs) || 45000),
    settleMs: Math.max(0, Number(camera.settleMs) || 400),
    preferJpeg: camera.preferJpeg !== false,
    archiveRaw: camera.archiveRaw !== false,
    capturenoaf: !!camera.capturenoaf,
    mirrorCapture: camera.mirrorCapture === true,
    fallbackToWebcam: camera.fallbackToWebcam === true,
  };
}

function firstExisting(paths) {
  for (const p of paths) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function resolveCmdPath(cfg) {
  if (cfg.cmdPath && fs.existsSync(cfg.cmdPath)) return cfg.cmdPath;
  return firstExisting(DEFAULT_CMD_CANDIDATES);
}

function resolveRemoteCmdPath(cfg) {
  if (cfg.remoteCmdPath && fs.existsSync(cfg.remoteCmdPath)) return cfg.remoteCmdPath;
  return firstExisting(DEFAULT_REMOTE_CANDIDATES);
}

function resolveWatchFolder(cfg, appUserData) {
  if (cfg.watchFolder) {
    fs.mkdirSync(cfg.watchFolder, { recursive: true });
    return cfg.watchFolder;
  }
  const dir = path.join(appUserData, 'captures');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveArchiveFolder(cfg, appUserData) {
  if (!cfg.archiveRaw) return null;
  const dir = cfg.archiveFolder || path.join(appUserData, 'raw-archive');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function listImageFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((name) => {
      const abs = path.join(dir, name);
      try {
        const st = fs.statSync(abs);
        if (!st.isFile()) return null;
        const ext = path.extname(name).toLowerCase();
        if (!IMAGE_EXTS.has(ext)) return null;
        return { abs, name, ext, mtimeMs: st.mtimeMs, size: st.size };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function pickBestNewFile(beforeSet, afterFiles, preferJpeg) {
  const newcomers = afterFiles.filter((f) => !beforeSet.has(f.abs));
  if (!newcomers.length) return null;
  newcomers.sort((a, b) => b.mtimeMs - a.mtimeMs || b.size - a.size);
  if (preferJpeg) {
    const jpeg = newcomers.find((f) => PREFER_EXTS.includes(f.ext));
    if (jpeg) return jpeg;
  }
  return newcomers[0];
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runProcess(exe, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      windowsHide: true,
      cwd: path.dirname(exe),
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      reject(new Error(`Camera command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function isDigiCamControlUiRunning() {
  try {
    const { stdout } = await execFileAsync('tasklist', ['/FI', 'IMAGENAME eq CameraControl.exe', '/NH'], {
      windowsHide: true,
      timeout: 5000,
    });
    return /CameraControl\.exe/i.test(stdout);
  } catch {
    return false;
  }
}

async function probeUsbCmd(cmdPath, timeoutMs = 12000) {
  if (!cmdPath) return { tested: false, usbConnected: false };
  const tmp = path.join(os.tmpdir(), `dcc-probe-${Date.now()}.txt`);
  try {
    const r = await runProcess(cmdPath, ['/export', tmp], timeoutMs);
    const text = `${r.stdout}\n${r.stderr}`.toLowerCase();
    if (text.includes('no connected device')) {
      return { tested: true, usbConnected: false, detail: 'No USB device (normal for Sony α5000 — use Wi‑Fi in digiCamControl).' };
    }
    if (fs.existsSync(tmp)) {
      return { tested: true, usbConnected: true, detail: 'USB camera detected by CameraControlCmd.' };
    }
    return { tested: true, usbConnected: false, detail: (r.stdout || r.stderr || '').trim().slice(0, 200) };
  } catch (err) {
    return { tested: true, usbConnected: false, detail: err.message };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

async function probeWebSession(webPort) {
  const base = `http://127.0.0.1:${webPort}`;
  try {
    const res = await fetch(`${base}/session.json`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { online: false };
    const session = await res.json();
    let cameraLabel = '';
    const raw = JSON.stringify(session);
    const nameMatch = raw.match(/"Name"\s*:\s*"([^"]+)"/i) || raw.match(/"Camera"\s*:\s*"([^"]+)"/i);
    if (nameMatch) cameraLabel = nameMatch[1];
    return {
      online: true,
      cameraLabel,
      sessionFolder: session?.Folder || session?.folder || '',
    };
  } catch {
    return { online: false };
  }
}

async function waitForStableFile(filePath, timeoutMs, settleMs) {
  const start = Date.now();
  let lastSize = -1;
  let stableHits = 0;
  while (Date.now() - start < timeoutMs) {
    try {
      const st = fs.statSync(filePath);
      if (st.size > 0 && st.size === lastSize) {
        stableHits += 1;
        if (stableHits >= 2) return st.size;
      } else {
        stableHits = 0;
        lastSize = st.size;
      }
    } catch {
      stableHits = 0;
      lastSize = -1;
    }
    await wait(Math.max(100, settleMs));
  }
  throw new Error(`Timed out waiting for photo file to finish writing: ${filePath}`);
}

function mimeForExt(ext) {
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.png') return 'image/png';
  return 'application/octet-stream';
}

function archiveRawSiblings(jpegFile, watchFolder, archiveFolder, beforeSet) {
  if (!archiveFolder) return [];
  const stem = path.basename(jpegFile.name, jpegFile.ext).toLowerCase();
  const archived = [];
  for (const f of listImageFiles(watchFolder)) {
    if (beforeSet.has(f.abs)) continue;
    if (!['.arw', '.raf', '.raw', '.dng'].includes(f.ext)) continue;
    const rawStem = path.basename(f.name, f.ext).toLowerCase();
    if (rawStem !== stem && !rawStem.startsWith(stem) && !stem.startsWith(rawStem)) continue;
    const dest = path.join(archiveFolder, f.name);
    try {
      fs.copyFileSync(f.abs, dest);
      archived.push(dest);
    } catch {
      /* best-effort */
    }
  }
  return archived;
}

async function triggerRemoteCapture(remote, watchFolder, filename, timeoutMs) {
  const q = (p) => (/\s/.test(p) ? `"${p}"` : p);
  await runProcess(remote, ['/clean', '/c', `set session.folder ${q(watchFolder)}`], timeoutMs);
  const result = await runProcess(remote, ['/clean', '/c', `capture ${q(filename)}`], timeoutMs);
  const text = `${result.stdout}\n${result.stderr}`;
  if (/error|fail|not connected|no camera/i.test(text) && !/ok/i.test(text)) {
    throw new Error(
      `digiCamControl remote capture failed. Is the camera connected in the UI (Wi‑Fi → Sony)? ${text.trim().slice(0, 280)}`
    );
  }
  return result;
}

async function triggerHttpCapture(webPort, watchFolder, filename, timeoutMs) {
  const base = `http://127.0.0.1:${webPort}`;
  const folderEnc = encodeURIComponent(watchFolder);
  const fileEnc = encodeURIComponent(filename);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(`${base}/?slc=set&param1=session.folder&param2=${folderEnc}`, { signal: ctrl.signal });
    const cap = await fetch(`${base}/?slc=capture&param1=${fileEnc}&param2=`, { signal: ctrl.signal });
    const body = await cap.text();
    if (!cap.ok || /error/i.test(body)) {
      throw new Error(`HTTP capture failed (enable Settings → Webserver in digiCamControl). ${body.slice(0, 200)}`);
    }
    return { stdout: body, stderr: '' };
  } finally {
    clearTimeout(t);
  }
}

async function triggerDigiCamControl(cfg, watchFolder, stamp) {
  const captureFlag = cfg.capturenoaf ? '/capturenoaf' : '/capture';
  const waitArg = String(Math.min(20000, Math.max(2000, Math.floor(cfg.timeoutMs / 3))));
  const filename = path.join(watchFolder, `shot-${stamp}.jpg`);

  if (cfg.mode === 'http') {
    return triggerHttpCapture(cfg.webPort, watchFolder, filename, cfg.timeoutMs);
  }

  if (cfg.mode === 'remote') {
    const remote = resolveRemoteCmdPath(cfg);
    if (!remote) {
      throw new Error(
        'CameraControlRemoteCmd.exe not found. Install digiCamControl and leave it running, or set camera.remoteCmdPath.'
      );
    }
    const uiRunning = await isDigiCamControlUiRunning();
    if (!uiRunning) {
      throw new Error(
        'digiCamControl is not running. Start CameraControl.exe, connect the α5000 over Wi‑Fi (Smart Remote Control), then retry.'
      );
    }
    return triggerRemoteCapture(remote, watchFolder, filename, cfg.timeoutMs);
  }

  const cmd = resolveCmdPath(cfg);
  if (!cmd) {
    throw new Error(
      'CameraControlCmd.exe not found. Install digiCamControl from https://digicamcontrol.com/ or set camera.cmdPath in config.'
    );
  }

  return runProcess(cmd, ['/filename', filename, captureFlag, '/wait', waitArg], cfg.timeoutMs);
}

/**
 * Fire shutter and return { jpegPath, dataUrl, archivedRaw[], backend }.
 */
async function captureStill(cameraConfig, { appUserData, log = () => {} } = {}) {
  const cfg = normalizeCameraConfig(cameraConfig);
  if (cfg.backend === 'webcam') {
    throw new Error('Camera shutter backend is disabled (camera.backend = webcam). Enable gphoto2 or digiCamControl.');
  }

  const watchFolder = resolveWatchFolder(cfg, appUserData);
  const archiveFolder = resolveArchiveFolder(cfg, appUserData);
  const before = listImageFiles(watchFolder);
  const beforeSet = new Set(before.map((f) => f.abs));
  const stamp = Date.now();
  const named = path.join(watchFolder, `shot-${stamp}.jpg`);

  if (cfg.backend === 'gphoto2') {
    log(`gphoto2 capture start folder=${watchFolder}`);
    const saved = await captureViaGphoto(cfg, named, log);
    const chosen = listImageFiles(watchFolder).find((f) => f.abs === saved || f.abs === named) || {
      abs: saved,
      name: path.basename(saved),
      ext: path.extname(saved).toLowerCase() || '.jpg',
    };
    await waitForStableFile(chosen.abs, Math.max(5000, cfg.timeoutMs / 2), cfg.settleMs);
    const buf = fs.readFileSync(chosen.abs);
    const dataUrl = `data:${mimeForExt(chosen.ext)};base64,${buf.toString('base64')}`;
    log(`gphoto2 capture OK ${chosen.abs}`);
    return {
      ok: true,
      backend: 'gphoto2',
      path: chosen.abs,
      filename: chosen.name,
      dataUrl,
      archivedRaw: [],
      mirrorCapture: cfg.mirrorCapture,
    };
  }

  if (cfg.backend !== 'digicamcontrol') {
    throw new Error(`Unknown camera.backend: ${cfg.backend}`);
  }

  log(`digiCamControl capture start mode=${cfg.mode} folder=${watchFolder}`);
  const result = await triggerDigiCamControl(cfg, watchFolder, stamp);
  if (result.stdout) log(`digiCamControl stdout: ${result.stdout.trim().slice(0, 500)}`);
  if (result.stderr) log(`digiCamControl stderr: ${result.stderr.trim().slice(0, 500)}`);

  const deadline = Date.now() + cfg.timeoutMs;
  let chosen = null;
  while (Date.now() < deadline) {
    const after = listImageFiles(watchFolder);
    chosen = pickBestNewFile(beforeSet, after, cfg.preferJpeg);
    if (chosen) break;
    if (fs.existsSync(named)) {
      const st = fs.statSync(named);
      if (st.size > 0) {
        chosen = {
          abs: named,
          name: path.basename(named),
          ext: '.jpg',
          mtimeMs: st.mtimeMs,
          size: st.size,
        };
        break;
      }
    }
    await wait(250);
  }

  if (!chosen) {
    throw new Error(
      `No new photo file after shutter. ${SONY_WIFI_HINT} Also: RAW+JPEG on camera; match digiCamControl session folder to ${watchFolder}.`
    );
  }

  await waitForStableFile(chosen.abs, Math.max(5000, cfg.timeoutMs / 2), cfg.settleMs);

  if (!PREFER_EXTS.includes(chosen.ext)) {
    throw new Error(
      `Captured ${chosen.name} but booth needs JPEG/PNG. Set camera to RAW+JPEG (or JPEG) so a .JPG downloads with the .ARW.`
    );
  }

  const archivedRaw = archiveRawSiblings(chosen, watchFolder, archiveFolder, beforeSet);
  const buf = fs.readFileSync(chosen.abs);
  const dataUrl = `data:${mimeForExt(chosen.ext)};base64,${buf.toString('base64')}`;

  log(`digiCamControl capture OK ${chosen.abs} rawArchive=${archivedRaw.length}`);
  return {
    ok: true,
    backend: 'digicamcontrol',
    path: chosen.abs,
    filename: chosen.name,
    dataUrl,
    archivedRaw,
    mirrorCapture: cfg.mirrorCapture,
  };
}

async function startDigiCamLiveView(cfg) {
  const webPort = cfg.webPort || 5513;
  if (cfg.mode === 'remote') {
    const remote = resolveRemoteCmdPath(cfg);
    if (remote && (await isDigiCamControlUiRunning())) {
      await runProcess(remote, ['/clean', '/c', 'do LiveViewWnd_Show'], 15000);
    }
  }
  try {
    await fetch(`http://127.0.0.1:${webPort}/?CMD=LiveViewWnd_Show`, { signal: AbortSignal.timeout(3000) });
  } catch {
    /* webserver optional */
  }
  return { url: `http://127.0.0.1:${webPort}/liveview.jpg` };
}

async function stopDigiCamLiveView(cfg) {
  const webPort = cfg.webPort || 5513;
  if (cfg.mode === 'remote') {
    const remote = resolveRemoteCmdPath(cfg);
    if (remote) {
      try {
        await runProcess(remote, ['/clean', '/c', 'do LiveViewWnd_Hide'], 8000);
      } catch {
        /* ignore */
      }
    }
  }
  try {
    await fetch(`http://127.0.0.1:${webPort}/?CMD=LiveViewWnd_Hide`, { signal: AbortSignal.timeout(2000) });
  } catch {
    /* ignore */
  }
}

async function probeCameraBackend(cameraConfig, appUserData) {
  const cfg = normalizeCameraConfig(cameraConfig);
  const watchFolder = resolveWatchFolder(cfg, appUserData || os.tmpdir());

  if (cfg.backend === 'gphoto2') {
    const gphoto = await probeGphoto(cfg);
    const hints = [FUJI_HINT];
    if (gphoto.cameraDetected) hints.unshift('gPhoto2 sees Fujifilm camera on USB.');
    return {
      backend: 'gphoto2',
      previewSource: cfg.previewSource,
      watchFolder,
      gphoto,
      hints,
      ready: gphoto.available && gphoto.cameraDetected,
      captureSource: 'camera-shutter',
    };
  }

  if (cfg.backend === 'webcam' || cfg.backend === 'capture-card') {
    return {
      backend: cfg.backend,
      previewSource: cfg.previewSource,
      watchFolder,
      hints:
        cfg.backend === 'capture-card'
          ? [
              'HDMI → USB capture card (e.g. USB Video). Strips are frames from the HDMI feed — not the Windows desktop.',
              `Prefer device label containing: ${cameraConfig.preferredDeviceLabel || 'USB Video'}`,
            ]
          : ['Strips use the selected webcam preview.'],
      ready: true,
      captureSource: cfg.backend === 'capture-card' ? 'hdmi-capture-card' : 'screen-preview',
    };
  }

  const cmd = resolveCmdPath(cfg);
  const remote = resolveRemoteCmdPath(cfg);
  const uiRunning = await isDigiCamControlUiRunning();
  const usbProbe = cfg.mode === 'cmd' ? await probeUsbCmd(cmd) : { tested: false, usbConnected: null };
  const web = await probeWebSession(cfg.webPort);

  const hints = [];
  hints.push('Fujifilm X-T2: prefer camera.backend gphoto2 + USB TETHER SHOOTING AUTO.');
  hints.push(SONY_WIFI_HINT);

  if (cfg.mode === 'cmd' && usbProbe.tested && !usbProbe.usbConnected) {
    hints.push('No USB camera in digiCamControl — for X-T2 use gphoto2 backend or connect supported body.');
  }
  if (cfg.mode === 'remote' && !uiRunning) {
    hints.push('Start digiCamControl (CameraControl.exe) before capture.');
  }
  if (cfg.mode === 'remote' && uiRunning && !web.online) {
    hints.push('Optional: enable digiCamControl Settings → Webserver (port 5513) for HTTP mode fallback.');
  }
  if (web.online && web.cameraLabel) {
    hints.unshift(`Web session sees camera: ${web.cameraLabel}`);
  }

  const ready =
    cfg.backend === 'webcam' ||
    (cfg.mode === 'remote' ? !!remote && uiRunning : cfg.mode === 'http' ? web.online : !!cmd);

  return {
    backend: cfg.backend,
    mode: cfg.mode,
    previewSource: cfg.previewSource,
    cmdPath: cmd,
    remoteCmdPath: remote,
    watchFolder,
    webPort: cfg.webPort,
    cmdAvailable: !!cmd,
    remoteAvailable: !!remote,
    digiCamControlRunning: uiRunning,
    usbProbe,
    webSession: web,
    sonyWifiHint: SONY_WIFI_HINT,
    fujiHint: FUJI_HINT,
    hints,
    ready,
    captureSource: 'camera-shutter',
    liveViewUrl: web.online ? `http://127.0.0.1:${cfg.webPort}/liveview.jpg` : null,
  };
}

module.exports = {
  normalizeCameraConfig,
  captureStill,
  probeCameraBackend,
  startDigiCamLiveView,
  stopDigiCamLiveView,
  SONY_WIFI_HINT,
  FUJI_HINT,
};
