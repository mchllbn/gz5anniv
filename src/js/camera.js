/**
 * Camera — simple getUserMedia with reliable ready wait.
 * HDMI capture cards (Fuji etc.) often deliver letterboxed/pillarboxed frames;
 * we auto-crop black bars for preview + stills.
 */

let stream = null;
let liveViewTimer = null;
let liveViewBaseUrl = null;
let hdmiCrop = null; // { x, y, w, h, srcW, srcH } in video pixels
let hdmiCropTimer = null;

export function getStream() {
  return stream;
}

export function getHdmiCrop() {
  return hdmiCrop;
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

let gphotoPreviewTimer = null;
let gphotoPreviewInFlight = false;

export async function resolvePreferredVideoDeviceId(cfg) {
  const want = String(cfg?.camera?.preferredDeviceLabel || '').trim().toLowerCase();
  const cams = await listCameras();
  if (want) {
    const hit = cams.find((d) => d.label && d.label.toLowerCase().includes(want));
    if (hit?.deviceId) return hit.deviceId;
  }
  return cams[0]?.deviceId;
}

export function showGphotoPreviewImage(imgEl, canvasOrDataUrl, mirror = true) {
  if (!imgEl || !canvasOrDataUrl) return;
  const url =
    typeof canvasOrDataUrl === 'string'
      ? canvasOrDataUrl
      : canvasOrDataUrl.toDataURL?.('image/jpeg', 0.92);
  if (!url) return;
  imgEl.src = url;
  imgEl.hidden = false;
  imgEl.classList.toggle('mirrored', !!mirror);
}

export function stopGphotoPreviewPoll() {
  if (gphotoPreviewTimer) {
    clearInterval(gphotoPreviewTimer);
    gphotoPreviewTimer = null;
  }
}

export async function startGphotoPreviewPoll(imgEl, cfg, mirror = true) {
  stopGphotoPreviewPoll();
  if (!imgEl || !window.photobooth?.fetchGphotoPreview) return false;
  const ms = Math.max(1500, Number(cfg?.camera?.previewIntervalMs) || 2500);
  const tick = async () => {
    if (gphotoPreviewInFlight) return;
    gphotoPreviewInFlight = true;
    try {
      const r = await window.photobooth.fetchGphotoPreview();
      if (r?.ok && r.dataUrl) {
        imgEl.src = r.dataUrl;
        imgEl.hidden = false;
        imgEl.classList.toggle('mirrored', !!mirror);
      }
    } catch {
      /* skip frame */
    } finally {
      gphotoPreviewInFlight = false;
    }
  };
  await tick();
  gphotoPreviewTimer = setInterval(tick, ms);
  return true;
}

function stopLiveViewPoll() {
  stopGphotoPreviewPoll();
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
  const useGphotoPv =
    cam.backend === 'gphoto2' &&
    cam.previewSource === 'gphoto2' &&
    imgEl &&
    window.photobooth?.fetchGphotoPreview;

  if (useGphotoPv) {
    const allowHdmi = cam.previewFallbackCaptureCard !== false;
    let gphotoOk = false;
    try {
      const r = await window.photobooth.fetchGphotoPreview();
      gphotoOk = !!(r?.ok && r.dataUrl);
      if (gphotoOk) {
        imgEl.src = r.dataUrl;
        await stopCamera(videoEl, { stopTracks: false });
        setPreviewVisible({ videoEl, imgEl, mode: 'liveview' });
        await startGphotoPreviewPoll(imgEl, cfg, mirror);
        return 'gphoto-preview';
      }
    } catch {
      /* USB preview not supported or busy */
    }
    if (allowHdmi && videoEl) {
      try {
        const devId = deviceId || (await resolvePreferredVideoDeviceId(cfg));
        setPreviewVisible({ videoEl, imgEl, mode: 'video' });
        await startCamera(videoEl, { deviceId: devId, mirror, cfg });
        return 'gphoto-hdmi-preview';
      } catch (err) {
        console.warn('HDMI live view fallback failed', err);
      }
    }
    await stopCamera(videoEl, { stopTracks: true });
    setPreviewVisible({ videoEl, imgEl, mode: 'liveview' });
    return 'gphoto-preview-idle';
  }

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
  const hdVideo = {
    width: { ideal: w, min: 640 },
    height: { ideal: h, min: 480 },
    frameRate: { ideal: 30, max: 60 },
  };

  const tries = [];
  if (deviceId) {
    tries.push({ audio: false, video: { deviceId: { exact: deviceId }, ...hdVideo } });
    tries.push({
      audio: false,
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    tries.push({ audio: false, video: { deviceId: { ideal: deviceId }, ...hdVideo } });
    tries.push({ audio: false, video: { deviceId: { ideal: deviceId } } });
  }
  tries.push({ audio: false, video: { ...hdVideo } });
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

  await bumpCaptureTrackQuality(stream, cam);

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
  refreshHdmiCrop(videoEl, cam);
  startHdmiCropWatch(videoEl, cam);
  return stream;
}

/** Ask the capture card for the highest practical resolution. */
async function bumpCaptureTrackQuality(mediaStream, cam = {}) {
  const track = mediaStream?.getVideoTracks?.()?.[0];
  if (!track?.applyConstraints) return;
  const idealW = Math.max(1280, Number(cam.captureWidth) || 1920);
  const idealH = Math.max(720, Number(cam.captureHeight) || 1080);
  try {
    const caps = track.getCapabilities?.() || {};
    const maxW = caps.width?.max || idealW;
    const maxH = caps.height?.max || idealH;
    await track.applyConstraints({
      width: { ideal: Math.min(idealW, maxW), max: maxW },
      height: { ideal: Math.min(idealH, maxH), max: maxH },
      frameRate: { ideal: 30, max: 60 },
    });
  } catch {
    try {
      await track.applyConstraints({
        width: { ideal: idealW },
        height: { ideal: idealH },
      });
    } catch {
      /* keep negotiated size */
    }
  }
}

/**
 * Detect non-black content box (Fuji HDMI often has side/top black bars).
 * Returns null if the frame is almost full content.
 */
export function detectContentBounds(source, { threshold = 28, sampleStep = 4 } = {}) {
  const w = source.videoWidth || source.width || 0;
  const h = source.videoHeight || source.height || 0;
  if (w < 32 || h < 32) return null;

  const probe = document.createElement('canvas');
  const maxEdge = 480;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  probe.width = Math.max(32, Math.round(w * scale));
  probe.height = Math.max(32, Math.round(h * scale));
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  pctx.drawImage(source, 0, 0, probe.width, probe.height);
  const { data } = pctx.getImageData(0, 0, probe.width, probe.height);

  const isDark = (x, y) => {
    const i = (y * probe.width + x) * 4;
    return data[i] <= threshold && data[i + 1] <= threshold && data[i + 2] <= threshold;
  };

  let top = 0;
  let bottom = probe.height - 1;
  let left = 0;
  let right = probe.width - 1;

  outerTop: for (; top < probe.height; top += 1) {
    for (let x = 0; x < probe.width; x += sampleStep) {
      if (!isDark(x, top)) break outerTop;
    }
  }
  outerBottom: for (; bottom > top; bottom -= 1) {
    for (let x = 0; x < probe.width; x += sampleStep) {
      if (!isDark(x, bottom)) break outerBottom;
    }
  }
  outerLeft: for (; left < probe.width; left += 1) {
    for (let y = top; y <= bottom; y += sampleStep) {
      if (!isDark(left, y)) break outerLeft;
    }
  }
  outerRight: for (; right > left; right -= 1) {
    for (let y = top; y <= bottom; y += sampleStep) {
      if (!isDark(right, y)) break outerRight;
    }
  }

  const pad = 1;
  top = Math.max(0, top - pad);
  left = Math.max(0, left - pad);
  bottom = Math.min(probe.height - 1, bottom + pad);
  right = Math.min(probe.width - 1, right + pad);

  const cw = right - left + 1;
  const ch = bottom - top + 1;
  if (cw < probe.width * 0.55 || ch < probe.height * 0.55) {
    // Suspicious crop — keep full frame
    return { x: 0, y: 0, w, h, srcW: w, srcH: h };
  }
  if (cw >= probe.width * 0.97 && ch >= probe.height * 0.97) {
    return { x: 0, y: 0, w, h, srcW: w, srcH: h };
  }

  const sx = w / probe.width;
  const sy = h / probe.height;
  return {
    x: Math.round(left * sx),
    y: Math.round(top * sy),
    w: Math.round(cw * sx),
    h: Math.round(ch * sy),
    srcW: w,
    srcH: h,
  };
}

export function refreshHdmiCrop(videoEl, cam = {}) {
  if (!videoEl || cam.cropBlackBars === false) {
    hdmiCrop = null;
    applyHdmiPreviewTransform(videoEl, null);
    return null;
  }
  try {
    hdmiCrop = detectContentBounds(videoEl);
    applyHdmiPreviewTransform(videoEl, hdmiCrop);
    return hdmiCrop;
  } catch {
    return null;
  }
}

function startHdmiCropWatch(videoEl, cam = {}) {
  stopHdmiCropWatch();
  if (!videoEl || cam.cropBlackBars === false) return;
  hdmiCropTimer = setInterval(() => {
    if (!videoEl.isConnected || !videoEl.srcObject) {
      stopHdmiCropWatch();
      return;
    }
    refreshHdmiCrop(videoEl, cam);
  }, 2500);
}

function stopHdmiCropWatch() {
  if (hdmiCropTimer) {
    clearInterval(hdmiCropTimer);
    hdmiCropTimer = null;
  }
}

/** Zoom/pan the <video> so black HDMI bars are cropped out of the visible preview. */
export function applyHdmiPreviewTransform(videoEl, crop, { mirror = null } = {}) {
  if (!videoEl) return;
  const mirrored =
    mirror == null ? videoEl.classList.contains('mirrored') : !!mirror;

  if (!crop || crop.w >= crop.srcW * 0.97 && crop.h >= crop.srcH * 0.97) {
    videoEl.style.removeProperty('--hdmi-zoom');
    videoEl.style.removeProperty('--hdmi-ox');
    videoEl.style.removeProperty('--hdmi-oy');
    videoEl.classList.remove('hdmi-cropped');
    videoEl.style.transform = mirrored ? 'scaleX(-1)' : '';
    return;
  }

  const zoom = Math.max(crop.srcW / crop.w, crop.srcH / crop.h) * 1.01;
  const ox = ((crop.x + crop.w / 2) / crop.srcW) * 100;
  const oy = ((crop.y + crop.h / 2) / crop.srcH) * 100;
  videoEl.style.setProperty('--hdmi-zoom', String(zoom));
  videoEl.style.setProperty('--hdmi-ox', `${ox}%`);
  videoEl.style.setProperty('--hdmi-oy', `${oy}%`);
  videoEl.classList.add('hdmi-cropped');
  videoEl.style.transformOrigin = `${ox}% ${oy}%`;
  videoEl.style.transform = mirrored
    ? `scaleX(-1) scale(var(--hdmi-zoom, 1))`
    : `scale(var(--hdmi-zoom, 1))`;
}

/** Apply the same HDMI crop CSS to every live preview video. */
export function syncHdmiPreviewToVideos(videoEls, { mirror = true } = {}) {
  const list = (videoEls || []).filter(Boolean);
  for (const el of list) {
    applyHdmiPreviewTransform(el, hdmiCrop, { mirror });
  }
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
  stopHdmiCropWatch();
  hdmiCrop = null;
  if (stopTracks && stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
  if (videoEl) {
    videoEl.srcObject = null;
    videoEl.classList.remove('hdmi-cropped');
    videoEl.style.removeProperty('--hdmi-zoom');
    videoEl.style.transform = '';
    videoEl.style.transformOrigin = '';
  }
}

export function captureFrame(videoEl, { mirror = true, cropBlackBars = true } = {}) {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  if (!w || !h) {
    throw new Error('Camera not ready — no frame to capture');
  }

  let sx = 0;
  let sy = 0;
  let sw = w;
  let sh = h;
  if (cropBlackBars !== false) {
    const crop = hdmiCrop?.srcW === w && hdmiCrop?.srcH === h
      ? hdmiCrop
      : detectContentBounds(videoEl);
    if (crop && crop.w > 16 && crop.h > 16) {
      sx = crop.x;
      sy = crop.y;
      sw = crop.w;
      sh = crop.h;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (mirror) {
    ctx.translate(sw, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, sw, sh);
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
