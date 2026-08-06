/**
 * Capture N photos with countdown — only called after Phase 1 confirms.
 */

import { captureFrame, waitForVideo } from './camera.js';

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

    await waitForVideo(video, 3000);
    flash(flashEl);
    shots.push(captureFrame(video, { mirror }));
    onShotCaptured?.(shots.length - 1, shots[shots.length - 1], count, shots);

    if (i < count - 1) await sleep(pauseBetweenMs);
  }

  hideCountdown(countdownEl);
  return shots;
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
