/**
 * Fujifilm / gPhoto2 tether capture (X-T2: USB TETHER SHOOTING AUTO).
 * Real shutter + download — not a monitor or webcam frame grab.
 *
 * On Windows, WSL does not see USB until you attach the camera with usbipd-win.
 * Run: scripts/fuji-usb-wsl.ps1 (as Admin)
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');

const execFileAsync = promisify(execFile);

const USBIPD_STEPS =
  'WSL cannot see the camera USB yet. Use: & "C:/Program Files/usbipd-win/usbipd.exe" list, then bind --busid and attach --wsl. ' +
  'Restart PowerShell after install if usbipd is not recognized. See scripts/fuji-usb-wsl.ps1';

const FUJI_HINT =
  'Fujifilm X-T2: SET UP → CONNECTION SETTING → PC CONNECTION MODE → USB TETHER SHOOTING AUTO. ' +
  'Close X Acquire/Tether on Windows. For gPhoto2 via WSL: attach USB with usbipd (see Settings probe).';

const DEFAULT_GPHOTO_CANDIDATES = [
  path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'gphoto2', 'gphoto2.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'gphoto2', 'gphoto2.exe'),
];

function defaultWslDistro() {
  return process.env.WSL_DISTRO_NAME || 'Ubuntu';
}

function resolveGphotoPath(cfg) {
  if (cfg.gphotoPath && fs.existsSync(cfg.gphotoPath)) return { exe: cfg.gphotoPath, viaWsl: false, prefix: [] };
  for (const p of DEFAULT_GPHOTO_CANDIDATES) {
    if (fs.existsSync(p)) return { exe: p, viaWsl: false, prefix: [] };
  }
  if (cfg.useWslGphoto !== false) {
    return { exe: 'wsl', viaWsl: true, prefix: ['gphoto2'] };
  }
  return null;
}

function wslFileToWinPath(wslUnixPath) {
  const distro = defaultWslDistro();
  const rel = wslUnixPath.replace(/^\//, '').replace(/\//g, '\\');
  return `\\\\wsl.localhost\\${distro}\\${rel}`;
}

function runProcess(exe, args, timeoutMs, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      windowsHide: true,
      cwd: cwd || undefined,
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
      reject(new Error(`gPhoto2 timed out after ${timeoutMs}ms`));
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

async function wslAvailable() {
  try {
    await execFileAsync('wsl', ['echo', 'ok'], { windowsHide: true, timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

function parseDetectOutput(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let sawHeader = false;
  for (const line of lines) {
    if (line.includes('Model') && line.includes('Port')) {
      sawHeader = true;
      continue;
    }
    if (!sawHeader) continue;
    if (line.startsWith('-')) continue;
    if (/usb:/i.test(line) || /fuji/i.test(line)) return true;
    if (line.length > 3 && !/error|could not/i.test(line)) return true;
  }
  return false;
}

async function probeGphoto(cfg) {
  const inv = resolveGphotoPath(cfg);
  if (!inv) {
    return {
      available: false,
      cameraDetected: false,
      detail: 'gphoto2 not found.',
      fujiHint: FUJI_HINT,
      usbipdRequired: false,
    };
  }
  if (inv.viaWsl && !(await wslAvailable())) {
    return { available: false, cameraDetected: false, detail: 'WSL not available.', fujiHint: FUJI_HINT, usbipdRequired: false };
  }
  try {
    const args = [...inv.prefix, '--auto-detect'];
    const r = await runProcess(inv.exe, args, Math.min(15000, cfg.timeoutMs || 15000));
    const text = `${r.stdout}\n${r.stderr}`;
    const hasCamera = parseDetectOutput(text);
    const usbipdRequired = inv.viaWsl && !hasCamera;
    return {
      available: true,
      viaWsl: inv.viaWsl,
      gphotoPath: inv.viaWsl ? 'wsl gphoto2' : inv.exe,
      cameraDetected: hasCamera,
      detail: text.trim().slice(0, 500),
      fujiHint: FUJI_HINT,
      usbipdRequired,
      usbipdSteps: usbipdRequired ? USBIPD_STEPS : null,
    };
  } catch (err) {
    return {
      available: true,
      viaWsl: inv.viaWsl,
      gphotoPath: inv.viaWsl ? 'wsl gphoto2' : inv.exe,
      cameraDetected: false,
      detail: err.message,
      fujiHint: FUJI_HINT,
      usbipdRequired: !!inv.viaWsl,
      usbipdSteps: inv.viaWsl ? USBIPD_STEPS : null,
    };
  }
}

function formatGphotoFailure(r, inv) {
  const text = `${r.stdout || ''}\n${r.stderr || ''}`.trim();
  const lower = text.toLowerCase();
  if (inv.viaWsl && (lower.includes('could not detect') || lower.includes('no camera') || lower.includes('unknown model'))) {
    return `gPhoto2 cannot see the camera inside WSL. ${USBIPD_STEPS}`;
  }
  if (lower.includes('device busy') || lower.includes('could not claim')) {
    return `USB is in use by another app (close X Acquire, Tether, Imaging Edge). ${text.slice(0, 200)}`;
  }
  return `gPhoto2 failed (code ${r.code}). X-T2: USB TETHER SHOOTING AUTO. ${text.slice(0, 280)}`;
}

async function copyWslFileToWindows(wslUnixPath, destFile) {
  const winViaWsl = wslFileToWinPath(wslUnixPath);
  if (fs.existsSync(winViaWsl)) {
    fs.mkdirSync(path.dirname(destFile), { recursive: true });
    fs.copyFileSync(winViaWsl, destFile);
    return destFile;
  }
  throw new Error(`Expected file at ${winViaWsl} after gPhoto2 capture. Check WSL distro name (default Ubuntu).`);
}

async function captureViaGphoto(cfg, destFile, log) {
  const inv = resolveGphotoPath(cfg);
  if (!inv) {
    throw new Error(`gphoto2 not found. ${FUJI_HINT}`);
  }

  const pre = await probeGphoto(cfg);
  if (!pre.cameraDetected) {
    throw new Error(pre.usbipdSteps || pre.detail || FUJI_HINT);
  }

  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  const stamp = Date.now();

  if (inv.viaWsl) {
    const target = `/tmp/gz5-${stamp}.jpg`;
    const args = [...inv.prefix, '--capture-image-and-download', '--filename', target, '--force-overwrite'];
    log(`gphoto2 capture → ${target}`);
    const r = await runProcess(inv.exe, args, cfg.timeoutMs || 45000);
    if (r.code !== 0) {
      throw new Error(formatGphotoFailure(r, inv));
    }
    await copyWslFileToWindows(target, destFile);
    try {
      await runProcess('wsl', ['rm', '-f', target], 5000);
    } catch {
      /* ignore */
    }
    return destFile;
  }

  const args = [...inv.prefix, '--capture-image-and-download', '--filename', destFile, '--force-overwrite'];
  log(`gphoto2 capture → ${destFile}`);
  const r = await runProcess(inv.exe, args, cfg.timeoutMs || 45000);
  if (r.code !== 0 && !fs.existsSync(destFile)) {
    throw new Error(formatGphotoFailure(r, inv));
  }
  if (!fs.existsSync(destFile)) {
    throw new Error(`gPhoto2 finished but file missing: ${destFile}`);
  }
  return destFile;
}

module.exports = {
  FUJI_HINT,
  USBIPD_STEPS,
  probeGphoto,
  captureViaGphoto,
  resolveGphotoPath,
};
