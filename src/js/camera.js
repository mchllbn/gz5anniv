/**
 * Camera — simple getUserMedia with reliable ready wait.
 */

let stream = null;

export function getStream() {
  return stream;
}

export async function listCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'videoinput');
}

export async function startCamera(videoEl, { deviceId, mirror = true } = {}) {
  await stopCamera(videoEl);

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera API not available. Use Chrome/Edge over http://localhost');
  }

  // Prefer simple constraints — most reliable across Windows webcams
  const tries = [];
  if (deviceId) {
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
