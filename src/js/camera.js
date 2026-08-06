/**
 * Camera — simple getUserMedia with reliable ready wait.
 */

let stream = null;
let liveViewTimer = null;
let liveViewBaseUrl = null;

export function getStream() {
  return stream;
}

/** Shutter capture from camera (gPhoto2 / digiCamControl), not the preview video. */
export function usesTetherCapture(cfg) {
  const b = cfg?.camera?.backend;
  return (b === 'digicamcontrol' || b === 'gphoto2') && !!window.photobooth?.captureStill;
}

/** @deprecated use usesTetherCapture */
export function usesRemoteCapture(cfg) {
  return usesTetherCapture(cfg);
}

function stopLiveViewPoll() {
  if (liveViewTimer) {
    clearInterval(liveViewTimer);
    liveViewTimer = null;
  }
  liveViewBaseUrl = null;
  window.photobooth?.stopLiveView?.();
}

function setPreviewVisible({ videoEl, imgEl, mode }) {
  if (videoEl) videoEl.hidden = mode !== 'video';
  if (imgEl) imgEl.hidden = mode !== 'liveview';
}

export async function startSessionPreview({ videoEl, imgEl, cfg, deviceId, mirror = true } = {}) {
  stopLiveViewPoll();
  const cam = cfg?.camera || {};
  const useDccLv =
    cam.previewSource === 'digicamcontrol' &&
    cam.backend === 'digicamcontrol' &&
    window.photobooth?.startLiveView;

  if (useDccLv && imgEl) {
    await stopCamera(videoEl, { stopTracks: true });
    setPreviewVisible({ videoEl, imgEl, mode: 'liveview' });
    const r = await window.photobooth.startLiveView();
    if (r?.ok && r.url) {
      liveViewBaseUrl = r.url;
      const tick = () => {
        if (!liveViewBaseUrl) return;
        imgEl.src = `${liveViewBaseUrl}?t=${Date.now()}`;
      };
      tick();
      liveViewTimer = setInterval(tick, 120);
      imgEl.classList.toggle('mirrored', !!mirror);
      return 'liveview';
    }
  }

  if (imgEl) setPreviewVisible({ videoEl, imgEl, mode: 'video' });
  if (!videoEl) return null;
  await startCamera(videoEl, { deviceId, mirror, cfg });
  return 'video';
}

export async function stopSessionPreview({ videoEl, imgEl } = {}) {
  stopLiveViewPoll();
  if (imgEl) {
    imgEl.removeAttribute('src');
    imgEl.hidden = true;
  }
  if (videoEl) {
    videoEl.hidden = false;
    await stopCamera(videoEl);
  }
}

export async function listCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'videoinput');
}

export async function startCamera(videoEl, { deviceId, mirror = true, cfg = null } = {}) {
  await stopCamera(videoEl);

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera API not available. Use Chrome/Edge over http://localhost');
  }

  const cam = cfg?.camera || {};
  const w = Math.max(640, Number(cam.captureWidth) || 1920);
  const h = Math.max(480, Number(cam.captureHeight) || 1080);
  const hdVideo = { width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 30, max: 60 } };

  const tries = [];
  if (deviceId) {
    tries.push({ audio: false, video: { deviceId: { exact: deviceId }, ...hdVideo } });
    tries.push({ audio: false, video: { deviceId: { ideal: deviceId }, ...hdVideo } });
    tries.push({ audio: false, video: { deviceId: { ideal: deviceId } } });
  }
  tries.push({ audio: false, video: { facingMode: 'user' } });
  tries.push({ audio: false, video: true });

  let lastErr;
  for (const constraints of tries) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!stream) throw lastErr || new Error('Could not open camera');

  videoEl.srcObject = stream;
  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.classList.toggle('mirrored', !!mirror);

  try {
    await videoEl.play();
  } catch {
    // autoplay policies — muted should allow play; continue to waitForVideo
  }

  await waitForVideo(videoEl);
  return stream;
}

/** Wait until the video has real frames (needed before capture). */
export function waitForVideo(videoEl, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    function ok() {
      return videoEl.videoWidth > 16 && videoEl.videoHeight > 16 && !videoEl.paused;
    }

    if (ok()) {
      resolve();
      return;
    }

    const onReady = () => {
      if (ok()) {
        cleanup();
        resolve();
      }
    };

    const timer = setInterval(() => {
      if (ok()) {
        cleanup();
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        cleanup();
        reject(new Error('Camera started but no video frames. Try another camera or USB port.'));
      }
    }, 100);

    function cleanup() {
      clearInterval(timer);
      videoEl.removeEventListener('loadeddata', onReady);
      videoEl.removeEventListener('playing', onReady);
    }

    videoEl.addEventListener('loadeddata', onReady);
    videoEl.addEventListener('playing', onReady);
  });
}

export function detachVideo(videoEl) {
  if (videoEl) videoEl.srcObject = null;
}

/** Attach the active module stream to a video element (e.g. setup → capture handoff). */
export async function attachActiveStream(videoEl, { mirror = true } = {}) {
  if (!stream?.active || !videoEl) {
    throw new Error('Camera not running');
  }
  videoEl.srcObject = stream;
  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.classList.toggle('mirrored', !!mirror);
  try {
    await videoEl.play();
  } catch {
    /* autoplay policy */
  }
  await waitForVideo(videoEl);
}

export async function stopCamera(videoEl, { stopTracks = true } = {}) {
  if (stopTracks && stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
  if (videoEl) videoEl.srcObject = null;
}

export function captureFrame(videoEl, { mirror = true } = {}) {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  if (!w || !h) {
    throw new Error('Camera not ready — no frame to capture');
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(videoEl, 0, 0, w, h);
  return canvas;
}

/** Load a still (JPEG from digiCamControl / file) onto a canvas. */
export function imageDataUrlToCanvas(dataUrl, { mirror = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!dataUrl) {
      reject(new Error('No image data from camera'));
      return;
    }
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) {
        reject(new Error('Camera image has no dimensions'));
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (mirror) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('Could not decode camera still'));
    img.src = dataUrl;
  });
}

export function permissionDeniedMessage(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Camera blocked. Click the camera icon in the address bar → Allow, then Retry.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No camera found. Plug in a webcam and Retry.';
  }
  if (name === 'NotReadableError') {
    return 'Camera is busy (Zoom/Teams/Camera app). Close them and Retry.';
  }
  return err?.message || 'Could not start the camera.';
}
