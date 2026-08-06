/**
 * Capture N photos with countdown — only called after Phase 1 confirms.
 * Prefer real shutter stills (digiCamControl) so strips never include live-view OSD.
 */

import { captureFrame, waitForVideo, imageDataUrlToCanvas } from './camera.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runCaptureSession(opts) {
  const {
    video,
    countdownEl,
    flashEl,
    photoCount = 3,
    countdownSeconds = 3,
    pauseBetweenMs = 700,
    mirror = true,
    /** async () => HTMLCanvasElement — real shutter; required when tetherCapture */
    captureStill = null,
    tetherCapture = false,
    shouldAbort = () => false,
    onProgress,
    onShotCaptured,
  } = opts;

  const count = Math.max(1, Math.min(8, Number(photoCount) || 3));
  const shots = [];

  for (let i = 0; i < count; i++) {
    if (shouldAbort()) throw new Error('ABORTED');
    onProgress?.(i, count, shots);

    await runCountdown(countdownEl, countdownSeconds, shouldAbort);
    if (shouldAbort()) throw new Error('ABORTED');

    flash(flashEl);

    let canvas = null;
    if (typeof captureStill === 'function') {
      canvas = await captureStill();
    }
    if (!canvas) {
      if (tetherCapture) {
        throw new Error(
          'Camera shutter capture failed. Begin Capture uses the camera, not the monitor preview — check USB tether / gPhoto2 / digiCamControl.'
        );
      }
      await waitForVideo(video, 3000);
      canvas = captureFrame(video, { mirror });
    }

    shots.push(canvas);
    onShotCaptured?.(shots.length - 1, shots[shots.length - 1], count, shots);

    if (i < count - 1) await sleep(pauseBetweenMs);
  }

  hideCountdown(countdownEl);
  return shots;
}

/** Build a captureStill callback from Electron digiCamControl IPC. */
export function makeRemoteCaptureStill({ mirrorCapture = false, fallbackToWebcam = false } = {}) {
  if (!window.photobooth?.captureStill) return null;
  return async () => {
    const result = await window.photobooth.captureStill();
    if (result?.ok && result.dataUrl) {
      const mirror = result.mirrorCapture ?? mirrorCapture;
      return imageDataUrlToCanvas(result.dataUrl, { mirror: !!mirror });
    }
    if (fallbackToWebcam || result?.fallbackToWebcam) {
      console.warn('Remote capture failed; falling back to live preview frame', result?.error);
      return null;
    }
    throw new Error(result?.error || 'Remote camera capture failed');
  };
}

async function runCountdown(el, seconds, shouldAbort) {
  const n = Math.max(1, Number(seconds) || 3);
  if (!el) {
    await sleep(n * 1000);
    return;
  }
  el.hidden = false;
  for (let i = n; i >= 1; i--) {
    if (shouldAbort()) {
      hideCountdown(el);
      throw new Error('ABORTED');
    }
    el.textContent = String(i);
    await sleep(1000);
  }
  hideCountdown(el);
}

function hideCountdown(el) {
  if (!el) return;
  el.hidden = true;
  el.textContent = '';
}

function flash(el) {
  if (!el) return;
  el.classList.add('on');
  setTimeout(() => el.classList.remove('on'), 120);
}

export function revokeShots(shots) {
  if (!shots) return;
  for (const c of shots) {
    if (c) {
      c.width = 0;
      c.height = 0;
    }
  }
  shots.length = 0;
}
