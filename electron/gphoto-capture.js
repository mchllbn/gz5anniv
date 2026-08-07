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
const os = require('os');
const { promisify } = require('util');
const { execFile } = require('child_process');

const execFileAsync = promisify(execFile);

const USBIPD_STEPS =
  'WSL cannot see the Fujifilm USB yet. As Administrator: cd to the project and run scripts/attach-xt2-admin.ps1 (usbipd bind + attach). ' +
  'The C922 webcam stays on Windows for live preview — only attach the X-T2 USB cable to WSL. Then: wsl gphoto2 --auto-detect';

const FUJI_HINT =
  'Fujifilm X-T2: SET UP → CONNECTION SETTING → PC CONNECTION MODE → USB TETHER SHOOTING AUTO. ' +
  'Close X Acquire/Tether on Windows. For gPhoto2 via WSL: attach USB with usbipd (see Settings probe).';

const DEFAULT_GPHOTO_CANDIDATES = [
  path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'gphoto2', 'gphoto2.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'gphoto2', 'gphoto2.exe'),
];

function wslDistroArgs(cfg) {
  const d = String(cfg?.wslDistro || '').trim();
  return d ? ['-d', d] : [];
}

function resolveGphotoPath(cfg) {
  if (cfg.gphotoPath && fs.existsSync(cfg.gphotoPath)) return { exe: cfg.gphotoPath, viaWsl: false, prefix: [] };
  for (const p of DEFAULT_GPHOTO_CANDIDATES) {
    if (fs.existsSync(p)) return { exe: p, viaWsl: false, prefix: [] };
  }
  if (cfg.useWslGphoto !== false) {
    return { exe: 'wsl', viaWsl: true, prefix: [...wslDistroArgs(cfg), 'gphoto2'] };
  }
  return null;
}

/** Map /tmp/foo.jpg → \\wsl.localhost\Ubuntu-24.04\tmp\foo.jpg (uses default WSL distro). */
async function wslUnixToWindowsPath(unixPath, cfg) {
  const args = [...wslDistroArgs(cfg), 'wslpath', '-w', unixPath];
  const { stdout } = await execFileAsync('wsl', args, { windowsHide: true, timeout: 15000 });
  return stdout.trim().replace(/\r/g, '');
}

async function wslUnixFileExists(unixPath, cfg) {
  try {
    await execFileAsync('wsl', [...wslDistroArgs(cfg), 'test', '-f', unixPath], {
      windowsHide: true,
      timeout: 8000,
    });
    return true;
  } catch {
    return false;
  }
}

async function readFileFromWsl(unixPath, cfg) {
  if (!(await wslUnixFileExists(unixPath, cfg))) {
    throw new Error('Photo file was not downloaded from the camera (missing in WSL /tmp).');
  }
  try {
    const winPath = await wslUnixToWindowsPath(unixPath, cfg);
    if (winPath && fs.existsSync(winPath)) {
      return fs.readFileSync(winPath);
    }
  } catch {
    /* fall through */
  }
  try {
    const args = [...wslDistroArgs(cfg), 'cat', unixPath];
    const { stdout } = await execFileAsync('wsl', args, {
      windowsHide: true,
      timeout: 60000,
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'buffer',
    });
    if (!stdout?.length) {
      throw new Error('Downloaded photo file is empty.');
    }
    return stdout;
  } catch (err) {
    if (err?.message?.includes('Photo file was not downloaded')) throw err;
    throw new Error(
      'Photo file was not downloaded from the camera. Quit X Acquire, re-run attach-xt2-admin.ps1 as Admin, and set USB TETHER SHOOTING AUTO.'
    );
  }
}

function gphotoCaptureRunFailed(r) {
  const text = `${r.stdout || ''}\n${r.stderr || ''}`.toLowerCase();
  if (r.code !== 0) return true;
  return (
    text.includes('*** error ***') ||
    text.includes('ptp access denied') ||
    text.includes('could not get image') ||
    text.includes('could not capture')
  );
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

const USBIPD_EXE = path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'usbipd-win', 'usbipd.exe');

function attachCommandsForBusid(busid) {
  const q = `"C:/Program Files/usbipd-win/usbipd.exe"`;
  return (
    `Admin PowerShell (once per boot): ${q} bind --busid ${busid} ; ${q} attach --wsl --busid ${busid} ; wsl gphoto2 --auto-detect`
  );
}

/** X-T2 on Windows USB (before WSL attach). */
async function probeWindowsFujiUsb() {
  if (!fs.existsSync(USBIPD_EXE)) {
    return { installed: false, found: false, detail: 'usbipd-win not installed' };
  }
  try {
    const { stdout } = await execFileAsync(USBIPD_EXE, ['list'], { windowsHide: true, timeout: 12000 });
    const lines = stdout.split(/\r?\n/);
    for (const line of lines) {
      if (!/x-t2|fujifilm|04cb:02cd/i.test(line)) continue;
      const busid = line.trim().split(/\s+/)[0];
      if (!/^\d+-\d+$/.test(busid)) continue;
      const notShared = /not shared/i.test(line);
      const attached = /attached/i.test(line);
      return {
        installed: true,
        found: true,
        busid,
        vidpid: (line.match(/\b[0-9a-f]{4}:[0-9a-f]{4}\b/i) || [])[0] || '04cb:02cd',
        deviceName: 'X-T2',
        notShared,
        attachedToWsl: attached,
        attachCommands: attachCommandsForBusid(busid),
        detail: line.trim(),
      };
    }
    return { installed: true, found: false, detail: 'No Fujifilm device in usbipd list (check USB cable & TETHER mode)' };
  } catch (err) {
    return { installed: true, found: false, detail: err.message };
  }
}

async function probeGphoto(cfg) {
  const windowsUsb = await probeWindowsFujiUsb();
  const inv = resolveGphotoPath(cfg);
  if (!inv) {
    return {
      available: false,
      cameraDetected: false,
      detail: 'gphoto2 not found.',
      fujiHint: FUJI_HINT,
      usbipdRequired: false,
      windowsUsb: await probeWindowsFujiUsb(),
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
    const attachHint =
      usbipdRequired && windowsUsb.found && windowsUsb.attachCommands
        ? windowsUsb.attachCommands
        : USBIPD_STEPS;
    return {
      available: true,
      viaWsl: inv.viaWsl,
      gphotoPath: inv.viaWsl ? 'wsl gphoto2' : inv.exe,
      cameraDetected: hasCamera,
      detail: text.trim().slice(0, 500),
      fujiHint: FUJI_HINT,
      usbipdRequired,
      usbipdSteps: usbipdRequired ? attachHint : null,
      windowsUsb,
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
      usbipdSteps:
        inv.viaWsl && windowsUsb.found ? windowsUsb.attachCommands : inv.viaWsl ? USBIPD_STEPS : null,
      windowsUsb,
    };
  }
}

function sanitizeGphotoText(text) {
  if (!text) return '';
  return text.split(/For debugging messages,/i)[0].trim().slice(0, 320);
}

function formatGphotoFailure(r, inv) {
  const text = sanitizeGphotoText(`${r.stdout || ''}\n${r.stderr || ''}`.trim());
  const lower = text.toLowerCase();
  if (inv.viaWsl && (lower.includes('could not detect') || lower.includes('no camera') || lower.includes('unknown model'))) {
    return (
      'gPhoto2 in WSL sees no camera. Windows File Explorer can still show X-T2 — that is normal. ' +
      'Run scripts/attach-xt2-admin.ps1 as Administrator (usbipd bind + attach for BUSID 3-6), then wsl gphoto2 --auto-detect. ' +
      'Close X Acquire/Tether first. Camera: USB TETHER SHOOTING AUTO.'
    );
  }
  if (lower.includes('device busy') || lower.includes('could not claim')) {
    return `USB is in use by another app (close X Acquire, Tether, Imaging Edge, and quit the photobooth before testing in WSL). ${text.slice(0, 160)}`;
  }
  if (lower.includes('ptp access denied') || lower.includes('could not get image')) {
    return (
      'The camera fired but gPhoto2 could not download the photo (PTP Access Denied). ' +
      'Quit the photobooth, close Fujifilm X Acquire/Tether, unplug USB, run attach-xt2-admin.ps1 as Administrator, then npm start. ' +
      'On the X-T2: PC CONNECTION MODE = USB TETHER SHOOTING AUTO; IMAGE QUALITY = JPEG Fine or RAW+JPEG; turn off self-timer / drive = single.'
    );
  }
  return `gPhoto2 failed (code ${r.code}). ${text || 'X-T2: USB TETHER SHOOTING AUTO.'}`;
}

function isJpegBuffer(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function isFujiRawBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return false;
  return buf.slice(0, 12).toString('ascii') === 'FUJIFILMCCD-';
}

async function copyWslFileToWindows(wslUnixPath, destFile, cfg) {
  const buf = await readFileFromWsl(wslUnixPath, cfg);
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.writeFileSync(destFile, buf);
  return destFile;
}

async function captureViaGphoto(cfg, destFile, log) {
  const inv = resolveGphotoPath(cfg);
  if (!inv) {
    throw new Error(`gphoto2 not found. ${FUJI_HINT}`);
  }

  const pre = await probeGphoto(cfg);
  if (!pre.cameraDetected) {
    const msg = !pre.windowsUsb?.found
      ? 'Fujifilm X-T2 not on USB. Plug the X-T2 USB cable (C922 is separate — it stays on Windows for preview). Camera: USB TETHER SHOOTING AUTO. Then Admin PowerShell: .\\scripts\\attach-xt2-admin.ps1'
      : pre.usbipdSteps ||
      (pre.windowsUsb?.found
        ? `X-T2 on USB (${pre.windowsUsb.busid}) but not in WSL. ${pre.windowsUsb.attachCommands}`
        : pre.detail || FUJI_HINT);
    throw new Error(msg);
  }

  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  const baseDest = destFile;
  const maxAttempts = Math.max(1, Number(cfg.gphotoCaptureRetries) || 4);
  const retryDelayMs = Math.max(400, Number(cfg.gphotoRetryDelayMs) || 900);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const stamp = `${Date.now()}-${attempt}`;
    const attemptDest =
      attempt === 1 ? baseDest : baseDest.replace(/(\.[^./\\]+)?$/, `-${attempt}$1`);

    if (inv.viaWsl) {
      const target = `/tmp/gz5-${stamp}.jpg`;
      const args = [...inv.prefix, '--capture-image-and-download', '--filename', target, '--force-overwrite'];
      log(`gphoto2 capture → ${target} (attempt ${attempt}/${maxAttempts})`);
      const r = await runProcess(inv.exe, args, cfg.timeoutMs || 45000);
      const failText = `${r.stdout || ''}\n${r.stderr || ''}`.toLowerCase();
      const ptpDenied = failText.includes('ptp access denied') || failText.includes('could not get image');
      const fileOk = await wslUnixFileExists(target, cfg);
      if (gphotoCaptureRunFailed(r) || !fileOk) {
        const waitMs = ptpDenied ? Math.max(retryDelayMs, 2000) : retryDelayMs;
        if (attempt < maxAttempts) {
          log(
            formatGphotoFailure(
              {
                code: r.code || 1,
                stdout: r.stdout,
                stderr: !fileOk
                  ? `${r.stderr || ''}\nNo JPEG saved to ${target} (camera may have fired without USB download).`
                  : r.stderr,
              },
              inv
            )
          );
          await new Promise((res) => setTimeout(res, waitMs));
          continue;
        }
        throw new Error(
          formatGphotoFailure(
            {
              code: r.code || 1,
              stdout: r.stdout,
              stderr: !fileOk
                ? `${r.stderr || ''}\nNo JPEG saved to ${target} (camera may have fired without USB download).`
                : r.stderr,
            },
            inv
          )
        );
      }
      try {
        await copyWslFileToWindows(target, attemptDest, cfg);
      } catch (copyErr) {
        if (attempt < maxAttempts) {
          log(copyErr.message);
          await new Promise((res) => setTimeout(res, retryDelayMs));
          continue;
        }
        throw new Error(formatGphotoFailure({ code: 1, stdout: '', stderr: copyErr.message }, inv));
      }
      try {
        await runProcess('wsl', [...wslDistroArgs(cfg), 'rm', '-f', target], 5000);
      } catch {
        /* ignore */
      }
    } else {
      const args = [...inv.prefix, '--capture-image-and-download', '--filename', attemptDest, '--force-overwrite'];
      log(`gphoto2 capture → ${attemptDest} (attempt ${attempt}/${maxAttempts})`);
      const r = await runProcess(inv.exe, args, cfg.timeoutMs || 45000);
      if (r.code !== 0 && !fs.existsSync(attemptDest)) {
        if (attempt < maxAttempts) {
          await new Promise((res) => setTimeout(res, retryDelayMs));
          continue;
        }
        throw new Error(formatGphotoFailure(r, inv));
      }
      if (!fs.existsSync(attemptDest)) {
        if (attempt < maxAttempts) {
          await new Promise((res) => setTimeout(res, retryDelayMs));
          continue;
        }
        throw new Error(`gPhoto2 finished but file missing: ${attemptDest}`);
      }
    }

    let buf;
    try {
      buf = fs.readFileSync(attemptDest);
    } catch {
      buf = null;
    }
    if (isJpegBuffer(buf)) {
      if (attemptDest !== baseDest) {
        fs.copyFileSync(attemptDest, baseDest);
        try {
          fs.unlinkSync(attemptDest);
        } catch {
          /* ignore */
        }
      }
      return baseDest;
    }

    const kind = isFujiRawBuffer(buf) ? 'RAF (RAW)' : 'non-JPEG';
    log(`gphoto2 download was ${kind}, expected JPEG — retry ${attempt}/${maxAttempts}`);
    try {
      fs.unlinkSync(attemptDest);
    } catch {
      /* ignore */
    }
    if (attempt < maxAttempts) {
      await new Promise((res) => setTimeout(res, retryDelayMs));
    }
  }

  throw new Error(
    'Camera sent RAW (.RAF) instead of JPEG. On the X-T2 set IMAGE QUALITY to RAW+JPEG or JPEG Fine, or the booth will retry automatically.'
  );
}

async function fetchGphotoPreview(cfg, log = () => {}) {
  const inv = resolveGphotoPath(cfg);
  if (!inv) throw new Error('gphoto2 not found');

  const target = inv.viaWsl ? '/tmp/gz5-preview.jpg' : path.join(os.tmpdir(), 'gz5-preview.jpg');
  const args = [...inv.prefix, '--capture-preview', '--filename', target, '--force-overwrite'];
  const r = await runProcess(inv.exe, args, Math.min(20000, cfg.timeoutMs || 20000));
  if (r.code !== 0) {
    throw new Error(formatGphotoFailure(r, inv));
  }

  let buf;
  if (inv.viaWsl) {
    buf = await readFileFromWsl(target, cfg);
  } else {
    if (!fs.existsSync(target)) throw new Error('Preview file missing after gPhoto2');
    buf = fs.readFileSync(target);
  }
  if (!isJpegBuffer(buf)) {
    throw new Error('Preview was not a JPEG (camera may have sent RAW).');
  }
  const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
  log('gphoto2 preview frame OK');
  return { ok: true, dataUrl };
}

module.exports = {
  FUJI_HINT,
  USBIPD_STEPS,
  probeGphoto,
  probeWindowsFujiUsb,
  captureViaGphoto,
  fetchGphotoPreview,
  resolveGphotoPath,
};
