/**
 * UI wiring for phase flow: idle → setup → capture → customize → album → print → idle
 */

import {
  loadBootstrap,
  getConfig,
  getFormat,
  formatAspectRatio,
  getState,
  saveConfig,
  composeSize,
  resolveAssetUrl,
} from './config.js';
import {
  Phase,
  getPhase,
  getSession,
  go,
  patchSession,
  resetSession,
  clearAll,
  subscribe,
} from './app.js';
import {
  startCamera,
  stopCamera,
  detachVideo,
  attachActiveStream,
  getStream,
  listCameras,
  permissionDeniedMessage,
  waitForVideo,
  usesTetherCapture,
  startSessionPreview,
  stopSessionPreview,
  refreshHdmiCrop,
  syncHdmiPreviewToVideos,
} from './camera.js';
import { runCaptureSession, revokeShots, makeRemoteCaptureStill } from './capture.js';
import { FILTERS, ADJUST_CONTROLS, DEFAULT_ADJUSTMENTS, normalizeAdjustments, PRINT_ADJUST_CONTROLS, DEFAULT_PRINT_ADJUSTMENTS, applyPrintColorToPngBase64 } from './filters.js';
import {
  templatesForFormatCount,
  pickTemplateForColor,
  getTemplate,
  clearTemplateCache,
  loadTemplateImage,
} from './frames.js';
import {
  composeStrip,
  canvasToPngBase64,
  drawPreview,
  composePrintSheet,
  composeStripA4Sheet,
  composePolaroidA4Sheet,
  composeLandscapeSheetA4Sheet,
  STRIP_PRINT_SHEET,
  POLAROID_PRINT_SHEET,
  LANDSCAPE_SHEET_PRINT_SHEET,
  singlePrintPageInches,
} from './compose.js';
import {
  STICKER_CATALOG,
  stickerThumbCanvas,
  normalizePlacements,
  nextStickerSlot,
  stickerSlotsForFormat,
  getStickerDef,
  createLockedBrandElements,
} from './stickers.js';
import {
  MAX_SHEET_ITEMS,
  MAX_STRIP_SHEET_ITEMS,
  MAX_POLAROID_SHEET_ITEMS,
  MAX_LANDSCAPE_SHEET_ITEMS,
  loadAlbum,
  addStripToAlbum,
  removeStripFromAlbum,
  getAlbumStripsByIds,
  makeAlbumThumb,
  normalizeStripForAlbum,
  loadPngBase64,
  albumCount,
} from './album.js';

const $ = (id) => document.getElementById(id);

let abortCapture = false;
let recomposeTimer = null;
let lastPhase = Phase.IDLE;
let customizeBusy = false;

function showPhase(phase) {
  document.querySelectorAll('[data-phase]').forEach((el) => {
    const p = el.dataset.phase;
    el.classList.toggle('active', p === phase);
  });
}

function setText(el, text) {
  if (el) el.textContent = text || '';
}

/* ——— Phase: Idle ——— */
function openSetup() {
  try {
    const cfg = getConfig();
    const d = cfg.defaults || {};
    const formatId = d.formatId || '2x6';
    const fmt = getFormat(formatId, cfg);
    const allowedPhotoCounts = fmt?.allowedPhotoCounts || cfg.allowedPhotoCounts || [3];
    const defaultPhotoCount = allowedPhotoCounts.includes(d.photoCount) ? d.photoCount : allowedPhotoCounts[0];
    const preferredTpl = getTemplate(d.templateId);
    const tpl = pickTemplateForColor(formatId, defaultPhotoCount, 'navy', preferredTpl?.id || d.templateId);
    patchSession({
      formatId,
      photoCount: defaultPhotoCount,
      countdownSeconds: d.countdownSeconds ?? 3,
      mirrorPreview:
        d.mirrorPreview != null
          ? !!d.mirrorPreview
          : cfg.camera?.backend !== 'capture-card',
      confettiOverlap: false,
      filterId: d.filter || 'natural',
      templateId: tpl?.id || d.templateId || 'anniversary-navy',
      printCopies: getConfig().copies || 1,
      safeBounds: false,
    });
    if (getSession().formatId === '6x4-polaroid') {
      patchSession({ formatId: '4x6-polaroid', photoCount: 1, templateId: 'polaroid-4x6' });
    }
    renderSetup();
    go(Phase.SETUP);
  } catch (err) {
    console.error('openSetup failed:', err);
    go(Phase.SETUP, { force: true });
    const hint = $('setup-preview-hint');
    if (hint) {
      hint.hidden = false;
      hint.textContent = err?.message || 'Setup could not fully load.';
    }
  }
}

/** Setup format picker — left-to-right display order. */
const SETUP_FORMAT_ORDER = ['4x6-polaroid', '2x6', '4x6', '6x4-four'];

function sortFormatsForSetup(formats) {
  const rank = (id) => {
    const i = SETUP_FORMAT_ORDER.indexOf(id);
    return i >= 0 ? i : SETUP_FORMAT_ORDER.length;
  };
  return [...formats].sort((a, b) => rank(a.id) - rank(b.id) || String(a.id).localeCompare(b.id));
}

/* ——— Phase 1: Setup (NO timer) ——— */
function renderSetup() {
  const cfg = getConfig();
  const session0 = getSession();
  const cfgFormats = Array.isArray(cfg.formats) && cfg.formats.length ? cfg.formats : [];
  const formatList = sortFormatsForSetup(
    cfgFormats.length
      ? cfgFormats
      : [
          {
            id: '2x6',
            label: '2x6 Strip',
            allowedPhotoCounts: cfg.allowedPhotoCounts || [3],
            canvasPx: { width: 600, height: 1800 },
            physicalSizeInches: { width: 2, height: 6 },
          },
        ]
  );

  const formatId = formatList.some((f) => f.id === session0.formatId)
    ? session0.formatId
    : formatList.find((f) => f.id === (cfg.defaults?.formatId || '2x6'))?.id || formatList[0].id;
  if (session0.formatId !== formatId) patchSession({ formatId });

  const session = getSession();
  // Shot count follows the selected format (3 for strip/sheet, 1 for Polaroid).
  const fmtAllowed = getFormat(formatId)?.allowedPhotoCounts || [3];
  const wantedCount = fmtAllowed.includes(session.photoCount) ? session.photoCount : fmtAllowed[0];
  if (session.photoCount !== wantedCount) patchSession({ photoCount: wantedCount });

  const session1 = getSession();
  const compatibleTemplates = templatesForFormatCount(formatId, session1.photoCount);
  if (!compatibleTemplates.some((tpl) => tpl.id === session1.templateId)) {
    const tpl = pickTemplateForColor(formatId, session1.photoCount, 'navy', session1.templateId);
    if (tpl) patchSession({ templateId: tpl.id });
  }

  // Output format size cards (visual 2×6 strip vs 4×6 collage)
  const formatWrap = $('output-format-chips');
  if (formatWrap) {
    formatWrap.className = 'format-size-row';
    formatWrap.innerHTML = '';
    for (const f of formatList) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isActive = getSession().formatId === f.id;
      btn.className = 'format-size-card' + (isActive ? ' active' : '');
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      btn.dataset.formatId = f.id;

      const thumb = document.createElement('span');
      thumb.className = `format-size-thumb format-size-thumb--${f.id} format-size-thumb--bg-navy`;
      thumb.setAttribute('aria-hidden', 'true');
      thumb.innerHTML =
        f.id === '4x6'
          ? `<span class="fmt-grid fmt-grid--4x6">
              <span class="fmt-slot"></span><span class="fmt-slot"></span>
              <span class="fmt-brand"></span><span class="fmt-slot"></span>
            </span>`
          : f.id === '4x6-polaroid'
            ? `<span class="fmt-grid fmt-grid--polaroid">
              <span class="fmt-slot fmt-slot--polaroid"></span>
              <span class="fmt-brand fmt-brand--polaroid"></span>
            </span>`
          : f.id === '6x4-four'
            ? `<span class="fmt-grid fmt-grid--four">
              <span class="fmt-brand"></span><span class="fmt-slot fmt-slot--wide"></span>
              <span class="fmt-slot"></span><span class="fmt-slot"></span><span class="fmt-slot"></span>
            </span>`
          : `<span class="fmt-grid fmt-grid--2x6">
              <span class="fmt-slot"></span><span class="fmt-slot"></span>
              <span class="fmt-slot"></span><span class="fmt-brand"></span>
            </span>`;

      const label = document.createElement('span');
      label.className = 'format-size-label';
      const meta =
        f.id === '4x6'
          ? { title: '4×6 Sheet', hint: '6×4″ · 3 photos' }
          : f.id === '4x6-polaroid'
            ? { title: '4×6 Polaroid', hint: '4×6″ · 1 photo' }
            : f.id === '6x4-four'
              ? { title: '6×4 Four', hint: '6×4″ · 4 photos' }
              : { title: '2×6 Strip', hint: '2×6″ portrait' };
      label.innerHTML = `<strong>${meta.title}</strong><small>${meta.hint}</small>`;

      btn.appendChild(thumb);
      btn.appendChild(label);
      btn.addEventListener('click', () => {
        const counts = f.allowedPhotoCounts || [3];
        const photoCount = counts[0];
        patchSession({ formatId: f.id, photoCount });
        const tpl = pickTemplateForColor(f.id, photoCount, 'navy', getSession().templateId);
        if (tpl) patchSession({ templateId: tpl.id });
        renderSetup();
      });
      formatWrap.appendChild(btn);
    }
  }

  // Countdown chips
  const times = cfg.allowedCountdowns || [3, 5, 10];
  const timeWrap = $('countdown-chips');
  timeWrap.innerHTML = '';
  for (const t of times) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip' + (getSession().countdownSeconds === t ? ' active' : '');
    btn.textContent = `${t}s`;
    btn.addEventListener('click', () => {
      patchSession({ countdownSeconds: t });
      renderSetup();
    });
    timeWrap.appendChild(btn);
  }

  $('setup-mirror').checked = getSession().mirrorPreview !== false;

  void renderOrientationPreview(getSession().photoCount);

  const begin = $('btn-begin');
  begin.disabled = !getSession().countdownSeconds || compatibleTemplates.length === 0;
  populateCameras();
  syncSetupPreviewVideos();
}

const STRIP_BASE_W_2X6 = 600;
const STRIP_BASE_H_2X6 = 1800;

/** Fallback slot layout when template metadata is missing. */
function fallbackSlotsForCount(n, baseW, baseH) {
  const sx = baseW / STRIP_BASE_W_2X6;
  const sy = baseH / STRIP_BASE_H_2X6;
  const base = baseW && baseH ? { sx, sy } : { sx: 1, sy: 1 };

  const scale = (s) => ({
    x: s.x * base.sx,
    y: s.y * base.sy,
    w: s.w * base.sx,
    h: s.h * base.sy,
  });

  // 4×6 landscape collage (1800×1200) — narrower brand column, wider right photos
  if (baseW > baseH && n === 3) {
    return [
      { x: 36, y: 36, w: 656, h: 544 },
      { x: 732, y: 36, w: 1032, h: 544 },
      { x: 732, y: 620, w: 1032, h: 544 },
    ];
  }

  // 6×4 four-up — logo TL, large TR, 3 small bottom
  if (baseW > baseH && n === 4) {
    return [
      { x: 664, y: 40, w: 1096, h: 604 },
      { x: 41, y: 684, w: 546, h: 476 },
      { x: 627, y: 684, w: 546, h: 476 },
      { x: 1213, y: 684, w: 546, h: 476 },
    ];
  }

  // 4×6 Polaroid portrait — single photo + chin
  if (baseH > baseW && n === 1) {
    return [{ x: 64, y: 64, w: 1072, h: 1316 }];
  }

  // 6×4 Polaroid legacy / landscape single
  if (baseW > baseH && n === 1) {
    return [{ x: 56, y: 56, w: 1688, h: 876 }];
  }

  if (n === 1) return [scale({ x: 30, y: 40, w: 540, h: 1120 })];
  if (n === 2) {
    return [
      scale({ x: 30, y: 36, w: 540, h: 560 }),
      scale({ x: 30, y: 620, w: 540, h: 560 }),
    ];
  }
  if (n === 4) {
    return [
      scale({ x: 24, y: 28, w: 264, h: 560 }),
      scale({ x: 312, y: 28, w: 264, h: 560 }),
      scale({ x: 24, y: 612, w: 264, h: 560 }),
      scale({ x: 312, y: 612, w: 264, h: 560 }),
    ];
  }
  return [
    scale({ x: 28, y: 26, w: 544, h: 409 }),
    scale({ x: 28, y: 449, w: 544, h: 409 }),
    scale({ x: 28, y: 872, w: 544, h: 411 }),
  ];
}

function slotPercentStyle(slot, baseW, baseH) {
  return {
    left: `${(slot.x / baseW) * 100}%`,
    top: `${(slot.y / baseH) * 100}%`,
    width: `${(slot.w / baseW) * 100}%`,
    height: `${(slot.h / baseH) * 100}%`,
  };
}

/** Vertical 2×6 strip mock — real frame art + slot layout for photo count. */
async function renderOrientationPreview(photoCount) {
  const mock = $('strip-mock');
  const slotsWrap = $('strip-mock-slots');
  const stage = $('strip-mock-stage');
  const frameImg = $('strip-mock-frame');
  const meta = $('orient-meta');
  if (!mock || !slotsWrap || !stage) return;

  const session = getSession();
  const n = Number(photoCount) || 3;
  const formatId = session.formatId || '2x6';
  const fmt = getFormat(formatId) || getFormat('2x6') || { canvasPx: { width: 600, height: 1800 } };
  const baseW = fmt?.canvasPx?.width ?? 600;
  const baseH = fmt?.canvasPx?.height ?? 1800;

  mock.style.setProperty('--strip-px-w', String(baseW));
  mock.style.setProperty('--strip-px-h', String(baseH));
  mock.style.setProperty('--strip-ar', `${baseW} / ${baseH}`);
  mock.style.aspectRatio = `${baseW} / ${baseH}`;
  if (stage) {
    stage.style.aspectRatio = '';
  }
  mock.dataset.orient = baseW >= baseH ? 'landscape' : 'portrait';

  const tplPreferred = getTemplate(session.templateId);
  const tpl =
    tplPreferred &&
    String(tplPreferred.formatId || '2x6') === String(formatId) &&
    Number(tplPreferred.photoCount) === n
      ? tplPreferred
      : pickTemplateForColor(formatId, n, 'navy', session.templateId);
  mock.dataset.count = String(n);

  stage.style.backgroundColor = tpl?.underfillColor || '#1a1610';

  slotsWrap.innerHTML = '';
  const slotRects = (tpl?.slots?.length ? tpl.slots : fallbackSlotsForCount(n, baseW, baseH)).slice(0, n);

  for (let i = 0; i < n; i++) {
    const rect = slotRects[i] || slotRects[slotRects.length - 1];
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.dataset.n = String(i + 1);
    Object.assign(slot.style, slotPercentStyle(rect, baseW, baseH));
    const vid = document.createElement('video');
    vid.className = 'slot-video';
    vid.playsInline = true;
    vid.autoplay = true;
    vid.muted = true;
    slot.appendChild(vid);
    slotsWrap.appendChild(slot);
  }

  if (frameImg && tpl) {
    try {
      const img = await loadTemplateImage(tpl);
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || baseW;
      c.height = img.naturalHeight || baseH;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const sx = c.width / baseW;
      const sy = c.height / baseH;
      const brandOverlap = Math.max(0, Number(tpl.brandOverlapPx) || 0);
      // Clear photo holes fully; keep overlapping brand pixels (Polaroid 20) in the hole
      slotRects.forEach((rect, i) => {
        const isBottom =
          i ===
          slotRects.reduce((best, r, idx, arr) => {
            const b = r.y + r.h;
            const bb = arr[best].y + arr[best].h;
            return b >= bb ? idx : best;
          }, 0);
        const keepBrand = isBottom && brandOverlap > 0 ? brandOverlap * sy : 0;
        ctx.clearRect(
          Math.round(rect.x * sx),
          Math.round(rect.y * sy),
          Math.round(rect.w * sx),
          Math.max(1, Math.round(rect.h * sy - keepBrand))
        );
      });
      frameImg.src = c.toDataURL('image/png');
      frameImg.alt = tpl.name || 'Strip frame preview';
      frameImg.hidden = false;
      mock.dataset.templateId = tpl.id;
    } catch {
      frameImg.hidden = true;
      mock.removeAttribute('data-template-id');
    }
  } else if (frameImg) {
    frameImg.hidden = true;
  }

  const frameLabel = tpl?.name
    ? `${tpl.name}`
    : formatId === '4x6'
      ? '4×6″ sheet'
      : formatId === '4x6-polaroid'
        ? '4×6″ Polaroid'
        : formatId === '6x4-four'
          ? '6×4″ four-up'
          : '2×6″ strip';
  if (meta) {
    const physW = fmt?.physicalSizeInches?.width ?? 2;
    const physH = fmt?.physicalSizeInches?.height ?? 6;
    const orient = baseW >= baseH ? 'Landscape' : 'Portrait';
    meta.innerHTML = `${frameLabel}<br/>${orient} · <strong>${physW}×${physH}″</strong> · <span>${n} photo${n === 1 ? '' : 's'}</span>`;
  }

  syncSetupPreviewVideos();
  requestAnimationFrame(() => {
    mock?.style?.removeProperty('width');
    mock?.style?.removeProperty('height');
  });
}

function setupPreviewVideoEls() {
  const main = $('setup-preview');
  const slots = document.querySelectorAll('.strip-mock-slots .slot-video');
  return [main, ...slots].filter(Boolean);
}

function syncSetupPreviewVideos() {
  const active = getStream();
  const mirror = getSession().mirrorPreview !== false;
  const live = !!active?.active;
  for (const el of setupPreviewVideoEls()) {
    if (live) {
      if (el.srcObject !== active) el.srcObject = active;
      el.classList.toggle('mirrored', mirror);
      el.play().catch(() => {});
    } else {
      detachVideo(el);
    }
  }
  document.querySelectorAll('.strip-mock-slots .slot').forEach((slot) => {
    slot.classList.toggle('has-live', live);
  });
  if (live) {
    const main = $('setup-preview');
    if (main) refreshHdmiCrop(main, getConfig().camera || {});
    syncHdmiPreviewToVideos(setupPreviewVideoEls(), { mirror });
  }
}

function detachSetupPreviewVideos() {
  for (const el of setupPreviewVideoEls()) detachVideo(el);
}

async function startSetupPreview() {
  const video = $('setup-preview');
  const img = $('setup-preview-liveview');
  const wrap = $('setup-camera-wrap');
  const hint = $('setup-preview-hint');
  if (!video) return;

  hint.hidden = true;
  hint.textContent = '';
  wrap?.classList.remove('is-error');
  updateCaptureSourceHint();

  const session = getSession();
  const cfg = getConfig();
  try {
    await startSessionPreview({
      videoEl: video,
      imgEl: img,
      cfg,
      deviceId: session.deviceId || undefined,
      mirror: session.mirrorPreview !== false,
    });
    if (!img?.hidden) {
      syncSetupPreviewVideos();
    } else {
      await waitForVideo(video, 8000);
      syncSetupPreviewVideos();
    }
    await populateCameras();
  } catch (err) {
    if (hint) {
      hint.hidden = false;
      hint.textContent = permissionDeniedMessage(err);
    }
    wrap?.classList.add('is-error');
    console.warn(err);
  }
}

function updateCaptureSourceHint() {
  const el = $('capture-source-hint');
  if (!el) return;
  const cfg = getConfig();
  if (usesTetherCapture(cfg)) {
    const dual = cfg.camera?.previewSource === 'capture-card';
    const b = cfg.camera?.backend === 'gphoto2' ? 'gPhoto2' : 'digiCamControl';
    el.textContent = dual
      ? `${b}: live view = HDMI (USB Video) · Begin Capture = real shutter + file download (JPEG on strip, RAW archived if enabled).`
      : `Begin Capture fires ${b} shutter (not a screenshot).`;
    el.hidden = false;
  } else if (cfg.camera?.backend === 'capture-card') {
    el.textContent =
      'HDMI capture card: Begin Capture saves a frame from the camera HDMI feed (USB Video). Black bars are auto-cropped. For best quality on Fuji: set HDMI to 1080p and turn Info Display OFF.';
    el.hidden = false;
  } else {
    el.textContent = 'Begin Capture saves what you see in the live preview.';
    el.hidden = false;
  }
}

async function stopSetupPreviewCompletely() {
  detachSetupPreviewVideos();
  await stopSessionPreview({ videoEl: $('setup-preview'), imgEl: $('setup-preview-liveview') });
}

function handoffSetupPreviewToCapture() {
  detachSetupPreviewVideos();
  const session = getSession();
  const captureVideo = $('video');
  captureVideo.classList.toggle('mirrored', session.mirrorPreview !== false);
  captureVideo.srcObject = getStream();
}

function backendToUi(cfg) {
  const b = cfg.camera?.backend;
  if (b === 'gphoto2' && cfg.camera?.previewSource === 'capture-card') return 'dual';
  return b === 'digicamcontrol' ? 'digicamcontrol' : b === 'gphoto2' ? 'gphoto2' : b === 'webcam' ? 'webcam' : 'capture-card';
}

function uiToBackend(uiValue) {
  if (uiValue === 'dual') return { backend: 'gphoto2', previewSource: 'capture-card' };
  if (uiValue === 'capture-card') return { backend: 'capture-card', previewSource: 'capture-card' };
  if (uiValue === 'gphoto2') return { backend: 'gphoto2', previewSource: 'webcam' };
  return { backend: uiValue || 'capture-card', previewSource: 'webcam' };
}

function usesHdmiPreview(cfg) {
  return cfg.camera?.previewSource === 'capture-card' || cfg.camera?.backend === 'capture-card';
}

async function populateCameras() {
  const field = $('camera-field');
  const select = $('setup-camera');
  const cfg = getConfig();
  try {
    const cams = await listCameras();
    const prefer = (cfg.camera?.preferredDeviceLabel || 'USB Video').toLowerCase();
    const session = getSession();
    if (!session.deviceId && usesHdmiPreview(cfg)) {
      const match = cams.find((c) => (c.label || '').toLowerCase().includes(prefer));
      if (match) patchSession({ deviceId: match.deviceId });
    }
    const showPicker = cams.length > 1 || usesHdmiPreview(cfg);
    if (!showPicker || !cams.length) {
      field.hidden = true;
      return;
    }
    field.hidden = false;
    select.innerHTML = '';
    for (const cam of cams) {
      const opt = document.createElement('option');
      opt.value = cam.deviceId;
      opt.textContent = cam.label || `Camera ${select.options.length + 1}`;
      select.appendChild(opt);
    }
    const deviceId = getSession().deviceId;
    if (deviceId) select.value = deviceId;
    else if (usesHdmiPreview(cfg)) {
      const match = cams.find((c) => (c.label || '').toLowerCase().includes(prefer));
      if (match) select.value = match.deviceId;
    }
  } catch {
    field.hidden = true;
  }
}

function confirmBeginCapture() {
  const session = getSession();
  if (!templatesForFormatCount(session.formatId || '2x6', session.photoCount).length)
    return;
  patchSession({
    mirrorPreview: $('setup-mirror').checked,
    deviceId: !$('camera-field').hidden ? $('setup-camera').value || null : session.deviceId,
  });
  handoffSetupPreviewToCapture();
  go(Phase.CAPTURE);
  startCapture();
}

/* ——— Phase 2: Capture ——— */
function syncCaptureFrameAspect(shotIndex = 0) {
  const frame = $('capture-frame');
  if (!frame) return;
  const session = getSession();
  const tpl = getTemplate(session.templateId) || pickTemplateForColor(
    session.formatId || '2x6',
    session.photoCount,
    'navy',
    session.templateId
  );
  const slots = tpl?.slots || [];
  const slot = slots[Math.min(Math.max(0, shotIndex), Math.max(0, slots.length - 1))] || slots[0];
  const ar = slot?.w && slot?.h ? slot.w / slot.h : 0.75;
  frame.style.setProperty('--cap-ar', String(Math.max(0.35, Math.min(2.8, ar))));
}

async function startCapture() {
  abortCapture = false;
  const session = getSession();
  const cfg = getConfig();
  $('cam-error').hidden = true;
  setText($('shot-label'), `Photo 1 of ${session.photoCount}`);
  resetCaptureProgress(session.photoCount);
  syncCaptureFrameAspect(0);

  const video = $('video');
  try {
    const live = getStream();
    if (live?.active) {
      await attachActiveStream(video, { mirror: session.mirrorPreview !== false });
      refreshHdmiCrop(video, cfg.camera || {});
      syncHdmiPreviewToVideos([video], { mirror: session.mirrorPreview !== false });
    } else {
      await startCamera(video, {
        deviceId: session.deviceId || undefined,
        mirror: session.mirrorPreview !== false,
        cfg: getConfig(),
      });
      await waitForVideo(video);
      refreshHdmiCrop(video, cfg.camera || {});
    }
    await populateCameras();

    patchSession({ capturing: true });
    const tether = usesTetherCapture(cfg);
    const captureStill = tether
      ? makeRemoteCaptureStill({
          mirrorCapture: cfg.camera?.mirrorCapture === true,
          fallbackToWebcam: cfg.camera?.fallbackToWebcam === true,
        })
      : null;
    const shots = await runCaptureSession({
      video,
      countdownEl: $('countdown'),
      flashEl: $('flash'),
      photoCount: session.photoCount,
      countdownSeconds: session.countdownSeconds,
      pauseBetweenMs: cfg.pauseBetweenShotsMs || 700,
      mirror: session.mirrorPreview !== false,
      captureStill,
      tetherCapture: tether,
      shouldAbort: () => abortCapture,
      onProgress: (i, n, shotsSoFar = []) => {
        syncCaptureFrameAspect(i);
        setText($('shot-label'), `Photo ${i + 1} of ${n}`);
        updateCaptureProgress(shotsSoFar.length, n, shotsSoFar);
      },
      onShotCaptured: (_index, _canvas, n, allShots) => {
        const done = allShots.length;
        if (done < n) {
          syncCaptureFrameAspect(done);
          setText($('shot-label'), `Photo ${done + 1} of ${n}`);
        } else {
          setText($('shot-label'), `All ${n} photos captured`);
        }
        updateCaptureProgress(done, n, allShots);
      },
    });

    await stopCamera(video);
    patchSession({ shots, capturing: false });

    const tpl = pickTemplateForColor(session.formatId || '2x6', session.photoCount, 'navy', session.templateId);
    if (tpl) patchSession({ templateId: tpl.id });

    go(Phase.CUSTOMIZE);
    await renderCustomize();
  } catch (err) {
    patchSession({ capturing: false });
    if (err?.message === 'ABORTED') {
      await stopCamera(video);
      go(Phase.IDLE, { force: true });
      clearAll(getConfig().defaults);
      return;
    }
    $('cam-error-text').textContent = permissionDeniedMessage(err);
    $('cam-error').hidden = false;
    console.error(err);
  }
}

async function cancelCapture() {
  if (getSession().capturing) {
    const ok = window.confirm('Cancel this session and return home?');
    if (!ok) return;
  }
  abortCapture = true;
  await stopCamera($('video'));
  clearAll(getConfig().defaults);
  go(Phase.IDLE, { force: true });
}

/* ——— Phase 3: Customize ——— */
async function renderCustomize() {
  const session = getSession();
  if (!Array.isArray(session.stickers) || !session.stickers.length) {
    patchSession({ stickers: createLockedBrandElements(session.formatId || '2x6') });
  }
  const current = getSession();
  if (!current.customizeTab || current.customizeTab === 'personalize' || current.customizeTab === 'frame') {
    patchSession({ customizeTab: 'effects' });
  }
  updateCustomizeTabUi('effects');
  renderFilterGallery();
  renderAdjustPanel();
  syncCustomizeRightPanel();
  setCustomizeActionsEnabled(true);
  ensureStripPreviewFitObserver();
  await recompose();
  fitStripPreviewToContainer();
}

function customizeActionEls() {
  return [
    'btn-print',
    'btn-save-album',
    'btn-save',
    'btn-open-album-from-customize',
    'btn-retake',
    'btn-start-over',
  ]
    .map($)
    .filter(Boolean);
}

function setCustomizeActionsEnabled(on) {
  for (const btn of customizeActionEls()) {
    btn.disabled = !on || customizeBusy;
  }
}

function setCustomizeBusy(busy) {
  customizeBusy = busy;
  setCustomizeActionsEnabled(getPhase() === Phase.CUSTOMIZE || getPhase() === Phase.PRINTING);
}

async function ensureComposedForExport() {
  const session = getSession();
  if (!session.shots?.length) {
    throw new Error('No photos to export — retake or start over.');
  }
  const template = getTemplate(session.templateId);
  if (!template) {
    throw new Error('Choose a frame before printing or saving.');
  }
  if (!session.pngBase64) {
    await recompose();
  }
  if (!getSession().pngBase64) {
    throw new Error('Could not build strip preview — check frame and try again.');
  }
}

let stripPreviewResizeObserver = null;

function clearStripPreview() {
  const strip = $('strip');
  if (!strip) return;
  const ctx = strip.getContext('2d');
  ctx.clearRect(0, 0, strip.width, strip.height);
}

function ensureStripPreviewFitObserver() {
  const wrap = $('strip-canvas-wrap');
  if (!wrap || stripPreviewResizeObserver) return;
  stripPreviewResizeObserver = new ResizeObserver(() => {
    if (getPhase() !== Phase.CUSTOMIZE) return;
    fitStripPreviewToContainer();
  });
  stripPreviewResizeObserver.observe(wrap);
  window.addEventListener('resize', () => {
    if (getPhase() !== Phase.CUSTOMIZE) return;
    fitStripPreviewToContainer();
  });
}

function thumbCanvasFromShot(shot, size = 96) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const scale = Math.max(size / shot.width, size / shot.height);
  const w = shot.width * scale;
  const h = shot.height * scale;
  ctx.drawImage(shot, (size - w) / 2, (size - h) / 2, w, h);
  return c;
}

function renderShotThumbs() {
  const wrap = $('shot-thumbs');
  if (!wrap) return;
  wrap.innerHTML = '';
  for (const shot of getSession().shots) {
    wrap.appendChild(thumbCanvasFromShot(shot, 96));
  }
}

function resetCaptureProgress(total) {
  const n = Math.max(1, Number(total) || 3);
  setText($('capture-saved-count'), `0 of ${n} captured`);
  const takes = $('capture-takes');
  if (!takes) return;
  takes.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const slot = document.createElement('div');
    slot.className = 'capture-take-slot';
    slot.dataset.index = String(i);
    const num = document.createElement('span');
    num.className = 'capture-take-num';
    num.textContent = String(i + 1);
    slot.appendChild(num);
    takes.appendChild(slot);
  }
}

function updateCaptureProgress(capturedCount, total, shots) {
  const n = Math.max(1, Number(total) || 3);
  const done = Math.min(n, Math.max(0, Number(capturedCount) || 0));
  setText($('capture-saved-count'), `${done} of ${n} captured`);

  const takes = $('capture-takes');
  if (!takes) return;

  const slots = takes.querySelectorAll('.capture-take-slot');
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const shot = shots?.[i];
    slot.classList.toggle('is-done', Boolean(shot));
    slot.classList.toggle('is-next', !shot && i === done);
    const existing = slot.querySelector('canvas');
    if (existing) existing.remove();
    const num = slot.querySelector('.capture-take-num');
    if (shot) {
      if (num) num.hidden = true;
      const thumb = thumbCanvasFromShot(shot, 72);
      thumb.className = 'capture-take-thumb';
      thumb.setAttribute('aria-label', `Photo ${i + 1}`);
      slot.appendChild(thumb);
    } else {
      if (num) {
        num.hidden = false;
        num.textContent = String(i + 1);
      }
    }
  }
}

function formatAdjustValue(key, value) {
  if (value === 0) return '0';
  return value > 0 ? `+${value}` : String(value);
}

function renderAdjustPanel() {
  const session = getSession();
  const panel = $('adjust-panel');
  if (panel) panel.hidden = session.adjustmentsEnabled !== true;
  const grid = $('adjust-grid');
  if (!grid) return;
  if (session.adjustmentsEnabled !== true) return;
  const adj = normalizeAdjustments(session.adjustments);
  if (!session.adjustments || typeof session.adjustments !== 'object') {
    patchSession({ adjustments: { ...adj } });
  }

  grid.innerHTML = '';
  for (const spec of ADJUST_CONTROLS) {
    const row = document.createElement('div');
    row.className = 'adjust-row';

    const label = document.createElement('label');
    label.className = 'adjust-label';
    label.textContent = spec.label;

    const valueEl = document.createElement('span');
    valueEl.className = 'adjust-value';
    valueEl.dataset.key = spec.key;
    valueEl.textContent = formatAdjustValue(spec.key, adj[spec.key]);

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'adjust-slider';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(adj[spec.key]);
    input.dataset.key = spec.key;
    input.setAttribute('aria-label', spec.label);

    input.addEventListener('input', () => {
      const next = normalizeAdjustments({
        ...getSession().adjustments,
        [spec.key]: Number(input.value),
      });
      valueEl.textContent = formatAdjustValue(spec.key, next[spec.key]);
      patchSession({ adjustments: next });
      scheduleRecompose();
    });

    row.append(label, input, valueEl);
    grid.appendChild(row);
  }
}

function resetAdjustments() {
  patchSession({ adjustments: { ...DEFAULT_ADJUSTMENTS } });
  renderAdjustPanel();
  scheduleRecompose();
}

function toggleAdjustPanel(open) {
  const session = getSession();
  if (session.adjustmentsEnabled !== true) return;
  const body = $('adjust-body');
  const btn = $('btn-advanced-toggle');
  if (!body || !btn) return;
  const show = open ?? body.hidden;
  body.hidden = !show;
  btn.setAttribute('aria-expanded', show ? 'true' : 'false');
  btn.classList.toggle('adjust-toggle-open', show);
}

function pushStickerHistory() {
  const session = getSession();
  const snap = JSON.stringify(
    normalizePlacements(session.stickers || [], session.formatId || '2x6')
  );
  const history = Array.isArray(session.personalizeHistory) ? session.personalizeHistory.slice(-24) : [];
  history.push(snap);
  patchSession({ personalizeHistory: history, personalizeFuture: [] });
}

function addSticker(stickerId) {
  const def = getStickerDef(stickerId);
  if (!def) return;
  const session = getSession();
  const formatId = session.formatId || '2x6';
  const stickers = normalizePlacements(session.stickers, formatId);
  const slot = nextStickerSlot(stickers, formatId);
  if (!slot) {
    const max = stickerSlotsForFormat(formatId).length;
    setText($('customize-status'), `All ${max} sticker spots are filled. Remove one to add another.`);
    return;
  }
  pushStickerHistory();
  const placement = normalizePlacements(
    [
      {
        id: `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        stickerId,
        ...slot,
        category: def.category,
      },
    ],
    formatId
  )[0];
  stickers.push(placement);
  patchSession({ stickers, selectedStickerId: placement.id });
  setText($('customize-status'), '');
  renderPersonalizeOverlay();
  scheduleRecompose();
}

function addTextSticker(rawText) {
  const text = String(rawText || '').trim().slice(0, 20);
  if (!text) return;
  const session = getSession();
  const formatId = session.formatId || '2x6';
  const stickers = normalizePlacements(session.stickers, formatId);
  const slot = nextStickerSlot(stickers, formatId);
  if (!slot) {
    const max = stickerSlotsForFormat(formatId).length;
    setText($('customize-status'), `All ${max} sticker spots are filled. Remove one to add another.`);
    return;
  }
  pushStickerHistory();
  const placement = normalizePlacements(
    [
      {
        id: `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'text',
        text,
        color: '#f9f1dc',
        ...slot,
        category: 'Text',
      },
    ],
    formatId
  )[0];
  stickers.push(placement);
  patchSession({ stickers, selectedStickerId: placement.id });
  setText($('customize-status'), '');
  renderPersonalizeOverlay();
  scheduleRecompose();
}

function renderStickerGallery() {
  const wrap = $('sticker-gallery');
  if (!wrap) return;
  wrap.innerHTML = '';
  for (const def of STICKER_CATALOG) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sticker-pick';
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', 'false');
    btn.dataset.id = def.id;
    btn.appendChild(stickerThumbCanvas(def, 40, 40));
    const label = document.createElement('span');
    label.textContent = def.label;
    btn.appendChild(label);
    btn.addEventListener('click', () => addSticker(def.id));
    wrap.appendChild(btn);
  }
}

function clearStickers() {
  pushStickerHistory();
  const locked = normalizePlacements(getSession().stickers || [], getSession().formatId || '2x6').filter((s) => s.locked);
  patchSession({ stickers: locked, selectedStickerId: null });
  renderPersonalizeOverlay();
  scheduleRecompose();
}

function renderFilterGallery() {
  const session = getSession();
  const wrap = $('filter-gallery');
  wrap.innerHTML = '';

  const adjustBtn = document.createElement('button');
  adjustBtn.type = 'button';
  adjustBtn.className = session.adjustmentsEnabled === true ? 'active' : '';
  adjustBtn.textContent = 'Advanced';
  adjustBtn.addEventListener('click', () => {
    const enable = session.adjustmentsEnabled !== true;
    patchSession({ adjustmentsEnabled: enable });
    if (!enable) toggleAdjustPanel(false);
    else toggleAdjustPanel(true);
    renderFilterGallery();
    renderAdjustPanel();
    scheduleRecompose();
  });
  wrap.appendChild(adjustBtn);

  for (const f of FILTERS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = session.filterId === f.id ? 'active' : '';
    btn.textContent = f.label;
    btn.addEventListener('click', () => {
      patchSession({ filterId: f.id, adjustmentsEnabled: false });
      toggleAdjustPanel(false);
      renderFilterGallery();
      renderAdjustPanel();
      scheduleRecompose();
    });
    wrap.appendChild(btn);
  }
}

function selectedSticker() {
  const session = getSession();
  const list = normalizePlacements(session.stickers || [], session.formatId || '2x6');
  return list.find((s) => s.id === session.selectedStickerId) || null;
}

function renderPersonalizeOverlay() {
  const strip = $('strip');
  const overlay = $('sticker-overlay');
  if (!strip || !overlay) return;
  overlay.width = strip.width;
  overlay.height = strip.height;
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const selected = selectedSticker();
  if (!selected) return;
  const session = getSession();
  const cfg = getConfig();
  const { scale, format } = composeSize(session.formatId || '2x6', cfg);
  const base = 72 * ((format?.canvasPx?.width ?? 600) / 600);
  const px = selected.x * scale;
  const py = selected.y * scale;
  const size = base * selected.size * scale;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate((selected.rotation * Math.PI) / 180);
  ctx.strokeStyle = selected.locked ? 'rgba(125,180,255,0.95)' : 'rgba(232,197,71,0.95)';
  ctx.lineWidth = 2;
  ctx.setLineDash(selected.locked ? [4, 4] : [8, 5]);
  ctx.strokeRect(-size * 0.55, -size * 0.55, size * 1.1, size * 1.1);
  ctx.restore();
}

function updateCustomizeTabUi(tabId = 'effects') {
  const panel = $('panel-effects');
  if (panel) {
    panel.classList.add('active');
    panel.hidden = false;
  }
}

function setCustomizeTab(tabId) {
  patchSession({ customizeTab: 'effects' });
  updateCustomizeTabUi('effects');
}

function syncCustomizeRightPanel() {
  const session = getSession();
  const safe = $('toggle-safe-bounds');
  if (safe) safe.checked = session.safeBounds === true;
}

function deleteSelectedSticker() {
  const session = getSession();
  const list = normalizePlacements(session.stickers || [], session.formatId || '2x6');
  const idx = list.findIndex((s) => s.id === session.selectedStickerId);
  if (idx < 0 || list[idx].locked) return;
  pushStickerHistory();
  list.splice(idx, 1);
  patchSession({ stickers: list, selectedStickerId: null });
  renderPersonalizeOverlay();
  scheduleRecompose();
}

function undoStickers() {
  const session = getSession();
  const history = Array.isArray(session.personalizeHistory) ? session.personalizeHistory : [];
  if (!history.length) return;
  const current = JSON.stringify(normalizePlacements(session.stickers || [], session.formatId || '2x6'));
  const prev = history[history.length - 1];
  const future = Array.isArray(session.personalizeFuture) ? session.personalizeFuture.slice() : [];
  future.push(current);
  patchSession({
    stickers: normalizePlacements(JSON.parse(prev), session.formatId || '2x6'),
    personalizeHistory: history.slice(0, -1),
    personalizeFuture: future.slice(-24),
    selectedStickerId: null,
  });
  renderPersonalizeOverlay();
  scheduleRecompose();
}

function redoStickers() {
  const session = getSession();
  const future = Array.isArray(session.personalizeFuture) ? session.personalizeFuture : [];
  if (!future.length) return;
  const current = JSON.stringify(normalizePlacements(session.stickers || [], session.formatId || '2x6'));
  const next = future[future.length - 1];
  const history = Array.isArray(session.personalizeHistory) ? session.personalizeHistory.slice() : [];
  history.push(current);
  patchSession({
    stickers: normalizePlacements(JSON.parse(next), session.formatId || '2x6'),
    personalizeHistory: history.slice(-24),
    personalizeFuture: future.slice(0, -1),
    selectedStickerId: null,
  });
  renderPersonalizeOverlay();
  scheduleRecompose();
}

function pickStickerAt(canvasX, canvasY) {
  const list = normalizePlacements(getSession().stickers || [], getSession().formatId || '2x6');
  const fmt = getFormat(getSession().formatId || '2x6', getConfig()) || { canvasPx: { width: 600, height: 1800 } };
  const base = 72 * ((fmt?.canvasPx?.width ?? 600) / 600);
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    const size = base * s.size * 0.56;
    const dx = Math.abs(canvasX - s.x);
    const dy = Math.abs(canvasY - s.y);
    if (dx <= size && dy <= size) return s;
  }
  return null;
}

function setupStickerOverlayEvents() {
  const overlay = $('sticker-overlay');
  const strip = $('strip');
  if (!overlay || !strip) return;

  // Select only — positions are fixed decoration slots (no drag / resize / rotate).
  overlay.addEventListener('pointerdown', (e) => {
    if (getSession().customizeTab !== 'personalize') return;
    const rect = overlay.getBoundingClientRect();
    const session = getSession();
    const cfg = getConfig();
    const { scale } = composeSize(session.formatId || '2x6', cfg);
    const xCanvas = ((e.clientX - rect.left) / rect.width) * strip.width;
    const yCanvas = ((e.clientY - rect.top) / rect.height) * strip.height;
    const x = xCanvas / scale;
    const y = yCanvas / scale;
    const picked = pickStickerAt(x, y);
    if (picked?.locked) {
      patchSession({ selectedStickerId: null });
    } else {
      patchSession({ selectedStickerId: picked?.id || null });
    }
    renderPersonalizeOverlay();
  });
}

function scheduleRecompose() {
  clearTimeout(recomposeTimer);
  recomposeTimer = setTimeout(() => recompose(), 40);
}

/** Scale strip + sticker overlay to fit the preview shell (any format aspect). */
function fitStripPreviewToContainer() {
  const wrap = $('strip-canvas-wrap');
  const strip = $('strip');
  const overlay = $('sticker-overlay');
  if (!wrap || !strip || !strip.width || !strip.height) return;

  const pad = 4;
  const availW = Math.max(1, wrap.clientWidth - pad);
  const availH = Math.max(1, wrap.clientHeight - pad);
  const scale = Math.min(availW / strip.width, availH / strip.height);
  const w = Math.max(1, Math.floor(strip.width * scale));
  const h = Math.max(1, Math.floor(strip.height * scale));

  strip.style.width = `${w}px`;
  strip.style.height = `${h}px`;
  if (overlay) {
    overlay.style.width = `${w}px`;
    overlay.style.height = `${h}px`;
  }
}

async function recompose() {
  const session = getSession();
  const template = getTemplate(session.templateId);
  if (!template || session.shots.length === 0) {
    setCustomizeActionsEnabled(false);
    return;
  }
  try {
    setCustomizeBusy(true);
    setText($('customize-status'), 'Updating preview…');
    const placements = normalizePlacements(session.stickers || [], session.formatId || '2x6');
    const lockedElements = placements.filter((s) => s.locked);
    const userElements = placements.filter((s) => !s.locked);
    const composed = await composeStrip(session.shots, {
      template,
      formatId: session.formatId || '2x6',
      filterId: session.filterId,
      adjustments: session.adjustmentsEnabled ? session.adjustments : DEFAULT_ADJUSTMENTS,
      lockedElements,
      stickers: userElements,
      safeBounds: session.safeBounds === true,
      confettiOverlap: false,
    });
    const png = canvasToPngBase64(composed);
    if (session.composed) {
      session.composed.width = 0;
      session.composed.height = 0;
    }
    patchSession({ composed, pngBase64: png });
    drawPreview(composed, $('strip'));
    fitStripPreviewToContainer();
    renderPersonalizeOverlay();
    setText($('customize-status'), '');
    setCustomizeActionsEnabled(true);
  } catch (err) {
    setText($('customize-status'), err.message || 'Compose failed');
    setCustomizeActionsEnabled(false);
  } finally {
    setCustomizeBusy(false);
  }
}

async function retakeAll() {
  if (!window.confirm('Discard these photos and take new ones? (Setup choices are kept.)')) {
    return;
  }
  const session = getSession();
  revokeShots(session.shots);
  patchSession({ shots: [], composed: null, pngBase64: null, stickers: [] });
  clearStripPreview();
  go(Phase.CAPTURE);
  startCapture();
}

async function startOver() {
  if (!window.confirm('End this session and return to the start screen?')) {
    return;
  }
  await stopCamera($('video'));
  await stopSetupPreviewCompletely();
  const session = getSession();
  revokeShots(session.shots);
  clearStripPreview();
  clearAll(getConfig().defaults);
  go(Phase.IDLE, { force: true });
}

function printSheetForAlbumItems(strips) {
  const formatIds = (strips || []).map((s) => s.formatId || '2x6');
  const allStrips = formatIds.length > 0 && formatIds.every((id) => String(id).includes('2x6'));
  const allPolaroids = formatIds.every((id) => String(id).includes('polaroid'));
  const kind = allStrips ? 'strip' : allPolaroids ? 'polaroid' : 'mixed';
  return {
    sheet: STRIP_PRINT_SHEET,
    kind,
    allStrips,
  };
}

function sheetSizeLabel(_sheet, kind = 'strip') {
  if (kind === 'strip') return 'A4 portrait · 4 horizontal 2×6 strip rows';
  if (kind === 'polaroid') return 'A4 portrait · 2×4 polaroid grid (8 slots)';
  if (kind === 'sheet') return 'A4 portrait · 2×2 landscape sheets (4×6 / four-up)';
  if (kind === 'mixed') return 'A4 (21.00×29.70 cm), mixed formats';
  return 'A4 sheet';
}

function sheetLayoutForKind(kind) {
  if (kind === 'strip') return { marginIn: 0.35, gapIn: 0.18 };
  if (kind === 'polaroid') return { marginIn: 0.4, gapIn: 0 };
  if (kind === 'sheet') return { marginIn: 0.4, gapIn: 0 };
  return { marginIn: 0.05, gapIn: 0.055 };
}

function isAlbumStripFormat(formatId) {
  return String(formatId || '').includes('2x6');
}

function isAlbumPolaroidFormat(formatId) {
  return String(formatId || '').includes('polaroid');
}

function isAlbumLandscapeSheetFormat(formatId) {
  const id = String(formatId || '').toLowerCase();
  return id === '4x6' || id === '6x4-four';
}

async function albumPrintEligibility() {
  const ids = [...(getSession().albumSelectedIds || [])];
  const n = ids.length;
  if (n < 1) {
    return {
      ok: false,
      n,
      kind: null,
      meta: '0 selected · strips (4), sheets (4), or polaroids (8)',
      status: '',
    };
  }
  const strips = await getAlbumStripsByIds(ids);
  if (strips.length !== n) {
    return { ok: false, n, kind: null, meta: `${n} selected`, status: 'Some selected items are missing.' };
  }
  const allStrips = strips.every((s) => isAlbumStripFormat(s.formatId));
  const allPolaroids = strips.every((s) => isAlbumPolaroidFormat(s.formatId));
  const allSheets = strips.every((s) => isAlbumLandscapeSheetFormat(s.formatId));

  if (allStrips) {
    if (n > MAX_STRIP_SHEET_ITEMS) {
      return {
        ok: false,
        n,
        kind: 'strip',
        meta: `${n} selected`,
        status: `A4 strip sheet fits ${MAX_STRIP_SHEET_ITEMS} strips max.`,
      };
    }
    return {
      ok: true,
      n,
      kind: 'strip',
      strips,
      meta: `${n} of ${MAX_STRIP_SHEET_ITEMS} strips · A4 stack ready`,
      status: '',
    };
  }

  if (allPolaroids) {
    if (n > MAX_POLAROID_SHEET_ITEMS) {
      return {
        ok: false,
        n,
        kind: 'polaroid',
        meta: `${n} selected`,
        status: `A4 polaroid sheet fits ${MAX_POLAROID_SHEET_ITEMS} polaroids max.`,
      };
    }
    return {
      ok: true,
      n,
      kind: 'polaroid',
      strips,
      meta: `${n} of ${MAX_POLAROID_SHEET_ITEMS} polaroids · A4 2×4 ready`,
      status: '',
    };
  }

  if (allSheets) {
    if (n > MAX_LANDSCAPE_SHEET_ITEMS) {
      return {
        ok: false,
        n,
        kind: 'sheet',
        meta: `${n} selected`,
        status: `A4 sheet layout fits ${MAX_LANDSCAPE_SHEET_ITEMS} items max.`,
      };
    }
    return {
      ok: true,
      n,
      kind: 'sheet',
      strips,
      meta: `${n} of ${MAX_LANDSCAPE_SHEET_ITEMS} sheets · A4 2×2 ready`,
      status: '',
    };
  }

  return {
    ok: false,
    n,
    kind: 'mixed',
    meta: `${n} selected · one format only`,
    status: 'Print one format per sheet — strips, 4×6/four-up sheets, or polaroids.',
  };
}

async function syncAlbumSelectionMeta() {
  const state = await albumPrintEligibility();
  setText($('album-selection-meta'), state.meta);
  const printBtn = $('btn-album-print');
  if (printBtn) printBtn.disabled = !state.ok;
  if (state.status) setText($('album-status'), state.status);
  else setText($('album-status'), '');
}

/* ——— Album ——— */
async function openAlbum({ preselectId = null, fromCustomize = false } = {}) {
  const selected = [];
  if (preselectId) selected.push(preselectId);
  else if (Array.isArray(getSession().albumSelectedIds)) {
    selected.push(...getSession().albumSelectedIds.slice(0, MAX_SHEET_ITEMS));
  }
  patchSession({ albumSelectedIds: selected });
  await renderAlbum();
  go(Phase.ALBUM, { force: fromCustomize || getPhase() === Phase.IDLE });
}

function formatAlbumDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function toggleAlbumSelection(id, formatId) {
  const current = [...(getSession().albumSelectedIds || [])];
  const idx = current.indexOf(id);
  if (idx >= 0) {
    current.splice(idx, 1);
  } else {
    const family = albumFormatFamily(formatId);
    if (current.length) {
      const firstEl = document.querySelector(`#album-grid [data-id="${CSS.escape(current[0])}"]`);
      const firstFam = albumFormatFamily(firstEl?.dataset.formatId || formatId);
      if (firstFam.key !== family.key) {
        setText(
          $('album-status'),
          'Select one format per print — strips, 4×6/four-up sheets, or polaroids.'
        );
        return;
      }
    }
    const max =
      family.key === 'polaroid'
        ? MAX_POLAROID_SHEET_ITEMS
        : family.key === 'sheet'
          ? MAX_LANDSCAPE_SHEET_ITEMS
          : MAX_STRIP_SHEET_ITEMS;
    if (current.length >= max) {
      setText(
        $('album-status'),
        family.key === 'polaroid'
          ? `A4 polaroid grid fits ${max} max — deselect one first.`
          : family.key === 'sheet'
            ? `A4 sheet grid fits ${max} max — deselect one first.`
            : `A4 strip sheet fits ${max} strips max — deselect one first.`
      );
      return;
    }
    current.push(id);
    setText($('album-status'), '');
  }
  patchSession({ albumSelectedIds: current });
  void renderAlbum();
}

/** Album card layout from format — portrait strips vs landscape sheets. */
function albumCardLayout(formatId) {
  const id = String(formatId || '2x6');
  const ar = formatAspectRatio(id, getConfig());
  const fmt = getFormat(id, getConfig());
  const label = fmt?.label || id;
  let orient = 'portrait';
  if (ar >= 1.15) orient = 'landscape';
  else if (ar >= 0.85) orient = 'square';
  return { ar, orient, label, formatId: id };
}

/** Group mixed formats so rows stay aligned (strips / sheets / polaroids). */
function albumFormatFamily(formatId) {
  const id = String(formatId || '2x6').toLowerCase();
  if (id.includes('polaroid')) return { key: 'polaroid', title: 'Polaroid', order: 3 };
  if (id.includes('6x4') || id === '4x6') return { key: 'sheet', title: 'Sheets', order: 2 };
  return { key: 'strip', title: '2×6 Strips', order: 1 };
}

function createAlbumCard(item, selected) {
  const layout = albumCardLayout(item.formatId || '2x6');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className =
    `album-card album-card--${layout.orient}` + (selected.has(item.id) ? ' is-selected' : '');
  btn.setAttribute('role', 'listitem');
  btn.setAttribute('aria-pressed', selected.has(item.id) ? 'true' : 'false');
  btn.dataset.id = item.id;
  btn.dataset.formatId = layout.formatId;
  btn.dataset.orient = layout.orient;
  btn.style.setProperty('--thumb-ar', String(layout.ar));

  const media = document.createElement('div');
  media.className = 'album-card-media';

  const img = document.createElement('img');
  img.className = 'album-card-thumb';
  img.src = item.thumbDataUrl || (item.pngBase64 ? `data:image/png;base64,${item.pngBase64}` : '');
  img.alt = `${layout.label} from ${formatAlbumDate(item.createdAt)}`;
  img.draggable = false;
  img.addEventListener(
    'load',
    () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        btn.style.setProperty('--thumb-ar', String(img.naturalWidth / img.naturalHeight));
      }
    },
    { once: true }
  );
  media.appendChild(img);

  const meta = document.createElement('div');
  meta.className = 'album-card-meta';
  const formatTag = document.createElement('span');
  formatTag.className = 'album-card-format';
  formatTag.textContent = layout.label;
  const dateTag = document.createElement('span');
  dateTag.className = 'album-card-date';
  dateTag.textContent = formatAlbumDate(item.createdAt);
  meta.append(formatTag, dateTag);

  btn.append(media, meta);
  btn.addEventListener('click', () => toggleAlbumSelection(item.id, item.formatId));
  return btn;
}

async function renderAlbum() {
  const grid = $('album-grid');
  const empty = $('album-empty');
  if (!grid) return;
  const items = await loadAlbum();
  const selected = new Set(getSession().albumSelectedIds || []);
  grid.innerHTML = '';

  if (!items.length) {
    if (empty) empty.hidden = false;
    syncAlbumSelectionMeta();
    return;
  }
  if (empty) empty.hidden = true;

  const families = new Map();
  for (const item of items) {
    const fam = albumFormatFamily(item.formatId || '2x6');
    if (!families.has(fam.key)) families.set(fam.key, { ...fam, items: [] });
    families.get(fam.key).items.push(item);
  }

  const ordered = [...families.values()].sort((a, b) => a.order - b.order);
  for (const fam of ordered) {
    const section = document.createElement('section');
    section.className = `album-section album-section--${fam.key}`;
    section.setAttribute('aria-label', fam.title);

    const heading = document.createElement('h3');
    heading.className = 'album-section-title';
    heading.textContent = `${fam.title} · ${fam.items.length}`;
    section.appendChild(heading);

    const row = document.createElement('div');
    row.className = 'album-section-grid';
    row.setAttribute('role', 'presentation');
    for (const item of fam.items) {
      row.appendChild(createAlbumCard(item, selected));
    }
    section.appendChild(row);
    grid.appendChild(section);
  }
  syncAlbumSelectionMeta();
}

async function saveCurrentStripToAlbum({ openAfter = false } = {}) {
  await ensureComposedForExport();
  const session = getSession();
  const pngBase64 = await normalizeStripForAlbum(session.pngBase64, session.formatId || '2x6', getConfig());
  let thumbDataUrl;
  try {
    thumbDataUrl = await makeAlbumThumb(pngBase64);
  } catch {
    thumbDataUrl = `data:image/png;base64,${pngBase64}`;
  }
  const items = await addStripToAlbum({
    pngBase64,
    thumbDataUrl,
    formatId: session.formatId || '2x6',
    templateId: session.templateId,
    photoCount: session.photoCount,
  });
  const newest = items[0];
  const count = await albumCount();
  setText(
    $('customize-status'),
    `Saved to album (${count} item${count === 1 ? '' : 's'}). Print: up to ${MAX_STRIP_SHEET_ITEMS} strips, ${MAX_LANDSCAPE_SHEET_ITEMS} sheets, or ${MAX_POLAROID_SHEET_ITEMS} polaroids per A4 page.`
  );
  if (openAfter && newest) {
    openAlbum({ preselectId: newest.id, fromCustomize: true });
  }
  return newest;
}

async function deleteSelectedAlbumStrips() {
  const ids = [...(getSession().albumSelectedIds || [])];
  if (!ids.length) {
    setText($('album-status'), 'Select strips to delete.');
    return;
  }
  const ok = window.confirm(`Delete ${ids.length} selected strip${ids.length === 1 ? '' : 's'} from the album?`);
  if (!ok) return;
  for (const id of ids) await removeStripFromAlbum(id);
  patchSession({ albumSelectedIds: [] });
  setText($('album-status'), 'Deleted.');
  await renderAlbum();
}

function leaveAlbum() {
  patchSession({ albumSelectedIds: [] });
  clearAll(getConfig().defaults);
  go(Phase.IDLE, { force: true });
}

async function printSelectedAlbumStrips() {
  const eligibility = await albumPrintEligibility();
  if (!eligibility.ok) {
    setText(
      $('album-status'),
      eligibility.status ||
        'Select strips, 4×6/four-up sheets, or polaroids (one format) for A4 print.'
    );
    syncAlbumSelectionMeta();
    return;
  }

  const printBtn = $('btn-album-print');
  if (printBtn) printBtn.disabled = true;
  const kind = eligibility.kind;
  setText(
    $('album-status'),
    kind === 'polaroid'
      ? 'Building A4 polaroid grid…'
      : kind === 'sheet'
        ? 'Building A4 sheet grid…'
        : 'Building A4 strip sheet…'
  );

  try {
    const strips = eligibility.strips;
    const images = [];
    for (const strip of strips) {
      images.push(await loadPngBase64(strip.pngBase64));
    }
    const sheet =
      kind === 'polaroid'
        ? composePolaroidA4Sheet(images, {
            cutGuides: true,
            marginIn: 0.4,
            dangerZone: false,
          })
        : kind === 'sheet'
          ? composeLandscapeSheetA4Sheet(images, {
              cutGuides: true,
              marginIn: 0.4,
              dangerZone: false,
            })
          : composeStripA4Sheet(images, {
              cutGuides: true,
              marginIn: 0.35,
              gapIn: 0.18,
            });
    const pngBase64 = canvasToPngBase64(sheet);
    const sheetSpec =
      kind === 'polaroid'
        ? POLAROID_PRINT_SHEET
        : kind === 'sheet'
          ? LANDSCAPE_SHEET_PRINT_SHEET
          : STRIP_PRINT_SHEET;
    patchSession({
      pngBase64,
      printMode: 'sheet',
      formatId: 'a4-sheet',
      printSheetKey: kind,
    });

    const cfg = getConfig();
    const useSilentKiosk = cfg.silentPrint === true && window.photobooth?.printStrip;
    if (useSilentKiosk) {
      const copies = Number(getSession().printCopies) || cfg.copies || 1;
      setText($('album-status'), 'Print preview ready. Click Print now when alignment looks right.');
      await openPrintPage(pngBase64, {
        autoDialog: false,
        mode: 'sheet',
        sheet: sheetSpec,
        printKind: kind,
        returnPhase: Phase.ALBUM,
        printAction: {
          type: 'silent',
          buttonLabel: 'Print now',
          statusTarget: 'album-status',
          payload: {
            pngBase64,
            printerName: cfg.printerName,
            copies,
            widthPx: sheet.width,
            heightPx: sheet.height,
            pageWidthIn: A4_PAGE_WIDTH_IN,
            pageHeightIn: A4_PAGE_HEIGHT_IN,
          },
        },
      });
    } else {
      await openPrintPage(pngBase64, {
        autoDialog: false,
        mode: 'sheet',
        sheet: sheetSpec,
        printKind: kind,
        returnPhase: Phase.ALBUM,
        printAction: { type: 'dialog', buttonLabel: 'Open print dialog' },
      });
    }
  } catch (err) {
    setText($('album-status'), err.message || 'Print sheet failed');
    if (getPhase() !== Phase.ALBUM) go(Phase.ALBUM, { force: true });
  } finally {
    void syncAlbumSelectionMeta();
  }
}

/* ——— Phase 4: Print / Save ——— */
function downloadPng(filename) {
  const session = getSession();
  if (!session.pngBase64) {
    throw new Error('Nothing to download — wait for preview to finish.');
  }
  const a = document.createElement('a');
  a.href = `data:image/png;base64,${session.pngBase64}`;
  a.download = filename || `strip-${Date.now()}.png`;
  a.click();
}

async function savePng() {
  await ensureComposedForExport();
  const name = `strip-${Date.now()}.png`;
  if (!window.photobooth?.savePng) {
    downloadPng(name);
    return { ok: true, downloaded: true };
  }
  const result = await window.photobooth.savePng({
    pngBase64: getSession().pngBase64,
    filename: name,
  });
  if (result?.ok === false) {
    throw new Error(result.error || 'Save failed');
  }
  return result;
}

let printPageResolve = null;
let printReturnPhase = Phase.IDLE;
let pendingPrintAction = null;
let rawPrintPngBase64 = null;
let printAdjustDraft = null;
let printAdjustEnabledDraft = true;
let printAdjustPermanentDraft = true;
let printPreviewBusy = false;
let printPreviewTimer = null;
const A4_PAGE_WIDTH_IN = 8.27;
const A4_PAGE_HEIGHT_IN = 11.69;

function getPrintAdjustments() {
  return normalizeAdjustments(getConfig().printAdjustments || DEFAULT_PRINT_ADJUSTMENTS);
}

function isPrintColorActive() {
  return printAdjustEnabledDraft !== false;
}

async function refreshPrintPreviewWithAdjustments() {
  if (!rawPrintPngBase64) return;
  while (printPreviewBusy) {
    await new Promise((r) => setTimeout(r, 40));
  }
  printPreviewBusy = true;
  try {
    let out = rawPrintPngBase64;
    if (isPrintColorActive()) {
      const adj = normalizeAdjustments(printAdjustDraft || getPrintAdjustments());
      out = await applyPrintColorToPngBase64(rawPrintPngBase64, adj);
    }
    await loadPrintStripImage(out);
    if (pendingPrintAction?.type === 'silent' && pendingPrintAction.payload) {
      pendingPrintAction = {
        ...pendingPrintAction,
        payload: { ...pendingPrintAction.payload, pngBase64: out },
      };
    }
    patchSession({ pngBase64: out });
  } catch (err) {
    setText($('print-adjust-status'), err.message || 'Could not update print preview');
  } finally {
    printPreviewBusy = false;
  }
}

function syncPrintColorOptionChecks() {
  const enabledEl = $('print-adj-enabled');
  const permanentEl = $('print-adj-permanent');
  if (enabledEl) enabledEl.checked = printAdjustEnabledDraft !== false;
  if (permanentEl) permanentEl.checked = printAdjustPermanentDraft !== false;
  const panel = $('print-advanced-panel');
  panel?.classList.toggle('is-disabled', printAdjustEnabledDraft === false);
  const saveBtn = $('btn-print-adjust-save');
  if (saveBtn) {
    saveBtn.textContent =
      printAdjustPermanentDraft !== false ? 'Save for all prints' : 'Apply to this print only';
  }
}

function setPrintAction(action = null) {
  pendingPrintAction = action;
  const btn = $('btn-print-dialog');
  if (!btn) return;
  btn.disabled = false;
  btn.textContent = action?.buttonLabel || 'Print';
}

function syncPrintAdjustValues() {
  const adj = printAdjustDraft || getPrintAdjustments();
  for (const spec of PRINT_ADJUST_CONTROLS) {
    const input = $(`print-adj-${spec.key}`);
    const val = $(`print-adj-val-${spec.key}`);
    if (input) input.value = String(adj[spec.key] ?? 0);
    if (val) val.textContent = String(adj[spec.key] ?? 0);
  }
  syncPrintColorOptionChecks();
}

function renderPrintAdjustControls() {
  const grid = $('print-adjust-grid');
  if (!grid || grid.dataset.ready === '1') {
    syncPrintAdjustValues();
    return;
  }
  grid.innerHTML = '';
  printAdjustDraft = { ...getPrintAdjustments() };
  for (const spec of PRINT_ADJUST_CONTROLS) {
    const row = document.createElement('div');
    row.className = 'print-adjust-row';
    const label = document.createElement('label');
    label.htmlFor = `print-adj-${spec.key}`;
    label.textContent = spec.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.id = `print-adj-${spec.key}`;
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(printAdjustDraft[spec.key] ?? 0);
    const val = document.createElement('span');
    val.className = 'print-adjust-value';
    val.id = `print-adj-val-${spec.key}`;
    val.textContent = String(printAdjustDraft[spec.key] ?? 0);
    input.addEventListener('input', () => {
      printAdjustDraft = {
        ...(printAdjustDraft || getPrintAdjustments()),
        [spec.key]: Number(input.value),
      };
      val.textContent = String(input.value);
      schedulePrintPreviewRefresh();
    });
    row.append(label, input, val);
    grid.appendChild(row);
  }
  grid.dataset.ready = '1';
  syncPrintColorOptionChecks();
}

function togglePrintAdvancedPanel() {
  const panel = $('print-advanced-panel');
  const btn = $('btn-print-advanced');
  if (!panel) return;
  const open = panel.hidden;
  panel.hidden = !open;
  btn?.setAttribute('aria-expanded', open ? 'true' : 'false');
  btn?.classList.toggle('active', open);
  if (open) {
    const cfg = getConfig();
    printAdjustEnabledDraft = cfg.printAdjustmentsEnabled !== false;
    printAdjustPermanentDraft = cfg.printAdjustmentsPermanent !== false;
    printAdjustDraft = { ...getPrintAdjustments() };
    renderPrintAdjustControls();
    setText($('print-adjust-status'), '');
  }
}

function schedulePrintPreviewRefresh() {
  if (printPreviewTimer) clearTimeout(printPreviewTimer);
  printPreviewTimer = setTimeout(() => {
    void refreshPrintPreviewWithAdjustments();
  }, 180);
}

async function savePrintAdjustmentsPermanently() {
  const adj = normalizeAdjustments(printAdjustDraft || getPrintAdjustments());
  const enabled = printAdjustEnabledDraft !== false;
  const permanent = printAdjustPermanentDraft !== false;

  if (permanent) {
    await saveConfig({
      printAdjustments: adj,
      printAdjustmentsEnabled: enabled,
      printAdjustmentsPermanent: true,
    });
    printAdjustDraft = { ...adj };
    setText(
      $('print-adjust-status'),
      enabled
        ? 'Saved permanently — used for all future prints.'
        : 'Saved permanently — color adjustments OFF for all future prints.'
    );
  } else {
    // Keep permanent profile in config, but mark permanent flag off so future opens can stay temporary.
    await saveConfig({
      printAdjustmentsPermanent: false,
      printAdjustmentsEnabled: enabled,
    });
    setText(
      $('print-adjust-status'),
      enabled
        ? 'Applied to this print only (not saved for future prints).'
        : 'Color adjustments off for this print.'
    );
  }
  syncPrintColorOptionChecks();
  await refreshPrintPreviewWithAdjustments();
}

async function resetPrintAdjustments() {
  printAdjustDraft = { ...DEFAULT_PRINT_ADJUSTMENTS };
  printAdjustEnabledDraft = true;
  syncPrintAdjustValues();
  setText($('print-adjust-status'), 'Reset to default bright-print profile.');
  await refreshPrintPreviewWithAdjustments();
}

function onPrintColorOptionChange() {
  const enabledEl = $('print-adj-enabled');
  const permanentEl = $('print-adj-permanent');
  printAdjustEnabledDraft = !!enabledEl?.checked;
  printAdjustPermanentDraft = !!permanentEl?.checked;
  syncPrintColorOptionChecks();
  schedulePrintPreviewRefresh();
  setText(
    $('print-adjust-status'),
    printAdjustEnabledDraft
      ? printAdjustPermanentDraft
        ? 'Will apply to this print. Save to keep for all prints.'
        : 'Will apply to this print only.'
      : 'Color adjustments disabled — original colors used.'
  );
}

function finishPrintSession() {
  setPrintAction(null);
  rawPrintPngBase64 = null;
  printAdjustDraft = null;
  printAdjustEnabledDraft = true;
  printAdjustPermanentDraft = true;
  const panel = $('print-advanced-panel');
  if (panel) panel.hidden = true;
  $('btn-print-advanced')?.setAttribute('aria-expanded', 'false');
  $('btn-print-advanced')?.classList.remove('active');
  if (printPageResolve) {
    printPageResolve({ ok: true });
    printPageResolve = null;
  }
  const backTo = printReturnPhase;
  printReturnPhase = Phase.IDLE;
  stopSetupPreviewCompletely();
  clearStripPreview();
  if (backTo === Phase.ALBUM) {
    patchSession({ printMode: 'strip' });
    go(Phase.ALBUM, { force: true });
    void renderAlbum();
    setText($('album-status'), 'Print finished — select more or go back.');
    return;
  }
  clearAll(getConfig().defaults);
  go(Phase.IDLE, { force: true });
}

function loadPrintStripImage(pngBase64) {
  const img = $('print-strip-img');
  if (!img) throw new Error('Print page is not available.');
  return new Promise((resolve, reject) => {
    const done = () => resolve(img);
    img.onload = done;
    img.onerror = () => reject(new Error('Could not load strip for printing.'));
    img.src = `data:image/png;base64,${pngBase64}`;
    if (img.complete && img.naturalWidth > 0) done();
  });
}

function applyPrintPreviewSizing(pageWidthIn, pageHeightIn) {
  const screen = document.querySelector('.print-screen');
  const target = $('print-target');
  const img = $('print-strip-img');
  if (screen && pageWidthIn > 0 && pageHeightIn > 0) {
    screen.style.setProperty('--paper-ar-w', String(pageWidthIn));
    screen.style.setProperty('--paper-ar-h', String(pageHeightIn));
  }
  if (target) {
    target.style.width = '';
    target.style.height = '';
  }
  if (img) {
    img.style.width = '';
    img.style.height = '';
  }
}

/** In-app print page → system print dialog (format-aware). */
async function openPrintPage(
  pngBase64,
  {
    autoDialog = true,
    mode = 'strip',
    sheet = STRIP_PRINT_SHEET,
    printKind = null,
    returnPhase = Phase.IDLE,
    printAction = null,
  } = {}
) {
  rawPrintPngBase64 = pngBase64;
  const cfg = getConfig();
  printAdjustEnabledDraft = cfg.printAdjustmentsEnabled !== false;
  printAdjustPermanentDraft = cfg.printAdjustmentsPermanent !== false;
  printAdjustDraft = { ...getPrintAdjustments() };
  let colored = pngBase64;
  if (printAdjustEnabledDraft !== false) {
    colored = await applyPrintColorToPngBase64(pngBase64, printAdjustDraft);
  }
  await loadPrintStripImage(colored);
  printReturnPhase = returnPhase;
  patchSession({ printMode: mode, pngBase64: colored });
  if (printAction?.type === 'silent' && printAction.payload) {
    printAction = {
      ...printAction,
      payload: { ...printAction.payload, pngBase64: colored },
    };
  }
  setPrintAction(printAction);
  renderPrintAdjustControls();
  const panel = $('print-advanced-panel');
  if (panel) panel.hidden = true;
  $('btn-print-advanced')?.setAttribute('aria-expanded', 'false');
  $('btn-print-advanced')?.classList.remove('active');
  const screen = document.querySelector('.print-screen');
  const title = $('print-screen-title');
  const hint = $('print-screen-hint');
  let paperW = A4_PAGE_WIDTH_IN;
  let paperH = A4_PAGE_HEIGHT_IN;
  try {
    if (mode === 'sheet' || mode === 'a4') {
      const sheetSpec = sheet || STRIP_PRINT_SHEET;
      screen?.style?.setProperty('--paper-w', `${A4_PAGE_WIDTH_IN}in`);
      screen?.style?.setProperty('--paper-h', `${A4_PAGE_HEIGHT_IN}in`);
      screen?.style?.setProperty('--sheet-w', `${A4_PAGE_WIDTH_IN}in`);
      screen?.style?.setProperty('--sheet-h', `${A4_PAGE_HEIGHT_IN}in`);
      screen?.setAttribute('data-print-mode', 'sheet');
      const kind =
        printKind ||
        (sheetSpec === POLAROID_PRINT_SHEET
          ? 'polaroid'
          : sheetSpec === LANDSCAPE_SHEET_PRINT_SHEET
            ? 'sheet'
            : 'strip');
      const maxItems =
        kind === 'polaroid'
          ? MAX_POLAROID_SHEET_ITEMS
          : kind === 'sheet'
            ? MAX_LANDSCAPE_SHEET_ITEMS
            : MAX_STRIP_SHEET_ITEMS;
      const titleKind =
        kind === 'sheet' ? '4×6 / four-up' : kind === 'polaroid' ? 'polaroid' : 'strip';
      if (title) title.textContent = `Print ${titleKind} sheet`;
      if (hint) {
        hint.innerHTML = `Review this preview first, then print. Paper: <strong>${sheetSizeLabel(sheetSpec, kind)}</strong> · up to ${maxItems} items.`;
      }
      const img = $('print-strip-img');
      if (img) {
        img.width = Math.round(A4_PAGE_WIDTH_IN * 300);
        img.height = Math.round(A4_PAGE_HEIGHT_IN * 300);
        img.alt = `${kind} print sheet ready to print`;
      }
      paperW = A4_PAGE_WIDTH_IN;
      paperH = A4_PAGE_HEIGHT_IN;
    } else {
      const session = getSession();
      const { pageWidthIn: pw, pageHeightIn: ph } = singlePrintPageInches(
        session.formatId || '2x6',
        cfg
      );
      screen?.style?.setProperty('--paper-w', `${pw}in`);
      screen?.style?.setProperty('--paper-h', `${ph}in`);
      screen?.style?.setProperty('--sheet-w', `${pw}in`);
      screen?.style?.setProperty('--sheet-h', `${ph}in`);
      screen?.setAttribute('data-print-mode', 'strip');
      if (title) title.textContent = 'Print your strip';
      if (hint) {
        hint.innerHTML = `Review the preview, then print. Paper: <strong>${(pw * 2.54).toFixed(2)}×${(ph * 2.54).toFixed(2)} cm</strong>.`;
      }
      const img = $('print-strip-img');
      if (img) {
        img.width = Math.round(pw * 300);
        img.height = Math.round(ph * 300);
        img.alt = 'Photo strip ready to print';
      }
      paperW = pw;
      paperH = ph;
    }
  } catch {
    /* optional */
  }
  go(Phase.PRINTING);
  requestAnimationFrame(() => {
    applyPrintPreviewSizing(paperW, paperH);
  });
  return new Promise((resolve) => {
    printPageResolve = resolve;
    const runDialog = () => {
      requestAnimationFrame(() => {
        setTimeout(() => window.print(), 120);
      });
    };
    if (autoDialog) runDialog();
  });
}

function browserPrint(pngBase64) {
  return openPrintPage(pngBase64, { autoDialog: true });
}

async function doPrint() {
  if (customizeBusy) return;
  const cfg = getConfig();
  const session = getSession();
  const size = composeSize(session.formatId, cfg);
  setCustomizeBusy(true);
  try {
    await ensureComposedForExport();
    const pngBase64 = getSession().pngBase64;
    try {
      await saveCurrentStripToAlbum({ openAfter: false });
    } catch (albumErr) {
      console.warn(albumErr);
    }
    if (cfg.saveLocalCopy !== false) {
      try {
        await savePng();
      } catch (saveErr) {
        console.warn(saveErr);
        setText($('customize-status'), `Saved copy failed: ${saveErr.message}. Opening print…`);
      }
    }

    const useSilentKiosk =
      cfg.silentPrint === true && window.photobooth?.printStrip;
    if (useSilentKiosk) {
      const copies = Number(getSession().printCopies) || cfg.copies || 1;
      const { pageWidthIn, pageHeightIn } = singlePrintPageInches(session.formatId, cfg);
      setText($('customize-status'), 'Print preview ready. Click Print now when alignment looks right.');
      await openPrintPage(pngBase64, {
        autoDialog: false,
        mode: 'strip',
        returnPhase: Phase.IDLE,
        printAction: {
          type: 'silent',
          buttonLabel: 'Print now',
          statusTarget: 'customize-status',
          payload: {
            pngBase64,
            printerName: cfg.printerName,
            copies,
            widthPx: size.width,
            heightPx: size.height,
            pageWidthIn,
            pageHeightIn,
          },
        },
      });
    } else {
      setText($('customize-status'), 'Opening print page…');
      await openPrintPage(pngBase64, {
        autoDialog: false,
        mode: 'strip',
        returnPhase: Phase.IDLE,
        printAction: { type: 'dialog', buttonLabel: 'Open print dialog' },
      });
    }
  } catch (err) {
    go(Phase.CUSTOMIZE, { force: true });
    setText($('customize-status'), err.message || 'Print failed — try again or Save PNG');
  } finally {
    setCustomizeBusy(false);
  }
}

/* ——— Settings ——— */
function openSettings() {
  $('settings').hidden = false;
  syncSettings();
}
function closeSettings() {
  $('settings').hidden = true;
}

async function syncSettings() {
  const st = await loadBootstrap();
  const cfg = st.config;
  const sel = $('set-printer');
  sel.innerHTML = '';
  const printers = st.printers?.length
    ? st.printers
    : [{ name: cfg.printerName || '(Electron only)' }];
  for (const p of printers) {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
  if (cfg.printerName) sel.value = cfg.printerName;
  $('set-copies').value = cfg.copies ?? 1;
  $('set-debug').checked = !!cfg.debugSlots;
  $('set-camera-dcc').checked = cfg.camera?.backend === 'digicamcontrol' || cfg.camera?.backend === 'gphoto2';
  if ($('set-camera-backend')) {
    $('set-camera-backend').value = backendToUi(cfg);
  }
  if ($('set-camera-mode')) {
    const m = cfg.camera?.mode;
    $('set-camera-mode').value = m === 'http' ? 'http' : m === 'cmd' ? 'cmd' : 'remote';
  }
  if (st.printerWarning) {
    $('printer-warn').hidden = false;
    $('printer-warn').textContent = st.printerWarning;
  } else {
    $('printer-warn').hidden = true;
  }
  await refreshCameraProbe();
}

async function refreshCameraProbe() {
  const el = $('camera-probe');
  if (!el) return;
  if (!window.photobooth?.probeCamera) {
    el.textContent = 'digiCamControl capture requires Electron (npm start).';
    return;
  }
  try {
    const probe = await window.photobooth.probeCamera();
    if (probe.backend === 'capture-card') {
      el.textContent = `HDMI capture card · strips = frames from USB Video (not desktop) · ${probe.hints?.[0] || ''}`;
      return;
    }
    if (probe.backend === 'webcam') {
      el.textContent = 'Strips = live preview from selected webcam.';
      return;
    }
    if (probe.backend === 'gphoto2') {
      const g = probe.gphoto || {};
      let line = [
        g.gphotoPath ? `gPhoto2: ${g.gphotoPath}` : 'gPhoto2',
        g.cameraDetected ? 'X-T2/USB detected' : 'No camera in WSL — run usbipd attach',
        probe.ready ? 'Shutter capture ready' : 'Not ready',
        `saves: ${probe.watchFolder}`,
      ].join(' · ');
      if (g.usbipdRequired && g.usbipdSteps) {
        line += ` — ${g.usbipdSteps}`;
      } else if (!probe.ready && probe.hints?.[0]) {
        line += ` — ${probe.hints[0].slice(0, 100)}…`;
      }
      el.textContent = line;
      return;
    }
    if (probe.backend !== 'digicamcontrol') {
      el.textContent = 'Unknown camera backend.';
      return;
    }
    const parts = [];
    if (probe.digiCamControlRunning) parts.push('digiCamControl running');
    else parts.push('digiCamControl NOT running — start CameraControl.exe');
    if (probe.webSession?.online) {
      parts.push(`web OK${probe.webSession.cameraLabel ? `: ${probe.webSession.cameraLabel}` : ''}`);
    }
    if (probe.usbProbe?.tested && !probe.usbProbe.usbConnected) {
      parts.push('USB: none (use Wi‑Fi for α5000)');
    } else if (probe.usbProbe?.usbConnected) {
      parts.push('USB: camera found');
    }
    const tool =
      probe.mode === 'http'
        ? probe.webSession?.online
          ? `HTTP :${probe.webPort}`
          : 'HTTP mode — enable Webserver in digiCamControl'
        : probe.mode === 'remote'
          ? probe.remoteAvailable
            ? probe.digiCamControlRunning
              ? 'Remote capture ready'
              : 'Remote — start digiCamControl + Wi‑Fi Sony'
            : 'Remote exe missing'
          : probe.cmdAvailable
            ? 'Cmd (USB)'
            : 'Cmd exe missing';
    el.textContent = `${tool} · ${parts.join(' · ')} · saves: ${probe.watchFolder}`;
    if (probe.hints?.length && !probe.ready) {
      el.textContent += ` — ${probe.hints[probe.hints.length - 1]}`;
    }
  } catch (err) {
    el.textContent = err?.message || 'Could not probe camera backend';
  }
}

async function saveSettings() {
  const cfg = getConfig();
  const uiBackend = $('set-camera-backend')?.value || 'capture-card';
  const mapped = uiToBackend(uiBackend);
  await saveConfig({
    printerName: $('set-printer').value,
    copies: Number($('set-copies').value) || 1,
    debugSlots: $('set-debug').checked,
    camera: {
      ...cfg.camera,
      backend: mapped.backend,
      previewSource: mapped.previewSource,
      mode:
        $('set-camera-mode')?.value === 'http'
          ? 'http'
          : $('set-camera-mode')?.value === 'cmd'
            ? 'cmd'
            : 'remote',
    },
  });
  setText($('settings-status'), 'Saved');
  await refreshCameraProbe();
  if (getPhase() === Phase.CUSTOMIZE) scheduleRecompose();
  setTimeout(() => setText($('settings-status'), ''), 1500);
}

async function testPrint() {
  setText($('settings-status'), 'Sending…');
  try {
    if (window.photobooth?.testPrint) {
      const r = await window.photobooth.testPrint({
        printerName: $('set-printer').value,
      });
      setText($('settings-status'), r.ok ? 'Sent' : r.error);
      return;
    }
    await browserPrint(
      // minimal placeholder
      await (async () => {
        const c = document.createElement('canvas');
        c.width = 600;
        c.height = 1800;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#1a1408';
        ctx.fillRect(0, 0, 600, 1800);
        ctx.fillStyle = '#c9a227';
        ctx.font = 'bold 32px Georgia';
        ctx.textAlign = 'center';
        ctx.fillText('TEST PRINT', 300, 900);
        return c.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
      })()
    );
    setText($('settings-status'), 'Print dialog opened');
  } catch (err) {
    setText($('settings-status'), err.message);
  }
}

/* ——— Bindings ——— */
function bindControl(id, event, handler) {
  const el = $(id);
  if (!el) {
    console.warn(`[photobooth] Missing #${id} — control not wired.`);
    return;
  }
  el.addEventListener(event, handler);
}

function bind() {
  bindControl('btn-start', 'click', () => openSetup());
  $('btn-open-album')?.addEventListener('click', () => openAlbum());
  bindControl('btn-setup-cancel', 'click', async () => {
    await stopSetupPreviewCompletely();
    clearAll(getConfig().defaults);
    go(Phase.IDLE, { force: true });
  });
  $('setup-mirror').addEventListener('change', (e) => {
    patchSession({ mirrorPreview: e.target.checked });
    syncSetupPreviewVideos();
  });
  $('setup-camera')?.addEventListener('change', async (e) => {
    patchSession({ deviceId: e.target.value || null });
    if (getPhase() !== Phase.SETUP) return;
    await startSetupPreview();
  });
  $('btn-begin').addEventListener('click', () => confirmBeginCapture());

  $('btn-capture-cancel').addEventListener('click', () => cancelCapture());
  $('btn-cam-retry').addEventListener('click', () => startCapture());
  $('btn-cam-home').addEventListener('click', () => cancelCapture());

  $('btn-print').addEventListener('click', () => void doPrint());
  $('btn-save-album')?.addEventListener('click', async () => {
    if (customizeBusy) return;
    setCustomizeBusy(true);
    try {
      await saveCurrentStripToAlbum({ openAfter: true });
    } catch (err) {
      setText($('customize-status'), err.message || 'Could not save to album');
    } finally {
      setCustomizeBusy(false);
    }
  });
  $('btn-open-album-from-customize')?.addEventListener('click', () => {
    if (customizeBusy) return;
    openAlbum({ fromCustomize: true });
  });
  $('btn-album-back')?.addEventListener('click', () => leaveAlbum());
  $('btn-album-print')?.addEventListener('click', () => void printSelectedAlbumStrips());
  $('btn-album-clear-selection')?.addEventListener('click', () => {
    patchSession({ albumSelectedIds: [] });
    setText($('album-status'), '');
    renderAlbum();
  });
  $('btn-album-delete-selected')?.addEventListener('click', () => void deleteSelectedAlbumStrips());
  $('btn-advanced-toggle')?.addEventListener('click', () => toggleAdjustPanel());
  $('btn-adjust-reset')?.addEventListener('click', () => resetAdjustments());
  $('toggle-safe-bounds')?.addEventListener('change', (e) => {
    patchSession({ safeBounds: e.target.checked });
    scheduleRecompose();
  });
  $('btn-print-dialog')?.addEventListener('click', async () => {
    const action = pendingPrintAction;
    if (!action || action.type === 'dialog') {
      // Ensure latest color profile is baked into the on-screen print image.
      if (rawPrintPngBase64) await refreshPrintPreviewWithAdjustments();
      window.print();
      return;
    }
    const btn = $('btn-print-dialog');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Printing…';
    }
    try {
      if (rawPrintPngBase64) await refreshPrintPreviewWithAdjustments();
      const result = await window.photobooth.printStrip(pendingPrintAction.payload);
      if (result && result.ok === false) throw new Error(result.error || 'Print failed');
      if (action.statusTarget) setText($(action.statusTarget), 'Printed — thank you!');
      finishPrintSession();
    } catch (err) {
      if (action.statusTarget) setText($(action.statusTarget), err.message || 'Print failed');
      const targetPhase = printReturnPhase === Phase.ALBUM ? Phase.ALBUM : Phase.CUSTOMIZE;
      go(targetPhase, { force: true });
    } finally {
      if (btn && getPhase() === Phase.PRINTING) {
        btn.disabled = false;
        btn.textContent = action.buttonLabel || 'Print';
      }
    }
  });
  $('btn-print-advanced')?.addEventListener('click', () => togglePrintAdvancedPanel());
  $('btn-print-adjust-save')?.addEventListener('click', () => void savePrintAdjustmentsPermanently());
  $('btn-print-adjust-reset')?.addEventListener('click', () => void resetPrintAdjustments());
  $('print-adj-enabled')?.addEventListener('change', () => onPrintColorOptionChange());
  $('print-adj-permanent')?.addEventListener('change', () => onPrintColorOptionChange());
  $('btn-print-done')?.addEventListener('click', () => finishPrintSession());
  window.addEventListener('afterprint', () => {
    if (getPhase() === Phase.PRINTING && printPageResolve) {
      finishPrintSession();
    }
  });
  $('btn-save').addEventListener('click', async () => {
    if (customizeBusy) return;
    setCustomizeBusy(true);
    try {
      const r = await savePng();
      try {
        await saveCurrentStripToAlbum({ openAfter: false });
      } catch (albumErr) {
        console.warn(albumErr);
      }
      setText(
        $('customize-status'),
        r.path ? `Saved: ${r.path}` : r.downloaded ? 'Downloaded PNG · also in album' : 'Saved · also in album'
      );
    } catch (err) {
      setText($('customize-status'), err.message || 'Save failed');
    } finally {
      setCustomizeBusy(false);
    }
  });
  $('btn-retake').addEventListener('click', () => {
    if (customizeBusy) return;
    void retakeAll();
  });
  $('btn-start-over').addEventListener('click', () => {
    if (customizeBusy) return;
    void startOver();
  });

  $('btn-settings-close').addEventListener('click', () => closeSettings());
  $('btn-settings-save').addEventListener('click', () => saveSettings());
  $('btn-test-print').addEventListener('click', () => testPrint());

  document.addEventListener('keydown', (e) => {
    const settingsOpen = !$('settings').hidden;
    const phase = getPhase();

    if (e.key === 'Escape') {
      if (settingsOpen) {
        closeSettings();
        return;
      }
      if (phase === Phase.SETUP) {
        void stopSetupPreviewCompletely();
        clearAll(getConfig().defaults);
        go(Phase.IDLE, { force: true });
      } else if (phase === Phase.CAPTURE) {
        cancelCapture();
      } else if (phase === Phase.CUSTOMIZE) {
        void startOver();
      } else if (phase === Phase.ALBUM) {
        leaveAlbum();
      } else if (phase === Phase.PRINTING) {
        finishPrintSession();
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === ',') {
      e.preventDefault();
      if (settingsOpen) closeSettings();
      else openSettings();
      return;
    }

    if (e.key === 'F11') {
      e.preventDefault();
      window.photobooth?.toggleFullscreen?.();
      return;
    }

    if (e.code === 'Space' && phase === Phase.IDLE && !settingsOpen) {
      e.preventDefault();
      openSetup();
      return;
    }

    if (e.key === 'Enter' && phase === Phase.SETUP && !settingsOpen) {
      e.preventDefault();
      if (!$('btn-begin').disabled) confirmBeginCapture();
    }

    if (e.key === 'Enter' && phase === Phase.ALBUM && !settingsOpen) {
      e.preventDefault();
      if (!$('btn-album-print')?.disabled) void printSelectedAlbumStrips();
    }
  });

  document.addEventListener('contextmenu', (e) => e.preventDefault());

  ensureStripPreviewFitObserver();

  subscribe((phase) => {
    showPhase(phase);
    if (phase === Phase.SETUP && lastPhase !== Phase.SETUP) {
      void startSetupPreview();
    } else if (lastPhase === Phase.SETUP && phase !== Phase.SETUP && phase !== Phase.CAPTURE) {
      void stopSetupPreviewCompletely();
    }
    lastPhase = phase;
  });

  setupStickerOverlayEvents();
}

function applyEventInfo() {
  const event = getConfig().event || {};
  const org = $('event-org');

  const agencyLogo =
    event.agencyLogo || event.logo || 'assets/templates/gz5-logo.png';
  const anniversaryLogo =
    event.anniversaryLogo || 'assets/templates/logo.png';
  const orgName =
    event.organization || 'Golden Z-5 Security & Investigation Agency, Inc.';

  if (org) org.textContent = orgName;

  document.querySelectorAll('[data-logo="agency"]').forEach((img) => {
    img.src = resolveAssetUrl(agencyLogo);
    img.alt = orgName;
  });
  document.querySelectorAll('[data-logo="anniversary"]').forEach((img) => {
    img.src = resolveAssetUrl(anniversaryLogo);
    img.alt = '';
  });

  const stOrg = $('settings-event-org');
  if (stOrg) stOrg.textContent = orgName;

  document.title =
    event.tagline ||
    [event.organization, event.title].filter(Boolean).join(' — ') ||
    'Photobooth';
}

async function init() {
  try {
    bind();
    await loadBootstrap();
    clearTemplateCache();
    applyEventInfo();
    clearAll(getConfig().defaults);
    showPhase(Phase.IDLE);
  } catch (err) {
    console.error('Photobooth init failed:', err);
    showPhase(Phase.IDLE);
    const hint = document.querySelector('[data-phase="idle"] .hint');
    if (hint) {
      hint.textContent =
        'Something went wrong loading the app. Press F12 for details, then refresh the page.';
    }
  }
}

init();

window.addEventListener('beforeunload', () => {
  stopCamera($('video'));
  clearTemplateCache();
  clearAll();
});
