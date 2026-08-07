/**
 * Strip composition.
 *
 * Template mode: **overlay**
 * 1. Underfill
 * 2. Photos into slots (object-fit: cover)
 * 3. Template PNG on top (transparent holes + branding + optional confetti in holes)
 * 4. If confettiOverlap is false, photos are redrawn on top to cover hole confetti
 */

import { composeSize, scaleSlots, getConfig, getFormat } from './config.js';
import { applyFilterToCanvas, drawCover } from './filters.js';
import { loadTemplateImage } from './frames.js';
import { drawStickersOnCanvas } from './stickers.js';

const CM_PER_IN = 2.54;
const A4_PORTRAIT_WIDTH_IN = cmToIn(21);
const A4_PORTRAIT_HEIGHT_IN = cmToIn(29.7);

export function cmToIn(cm) {
  return cm / CM_PER_IN;
}

/** Landscape cut sheet — four 2×6″ strips (20.17 × 6.72 cm). */
export const STRIP_PRINT_SHEET = Object.freeze({
  dpi: 300,
  widthCm: 20.17,
  heightCm: 6.72,
  maxItems: 4,
  get widthIn() {
    return cmToIn(this.widthCm);
  },
  get heightIn() {
    return cmToIn(this.heightCm);
  },
});

/** Landscape cut sheet — four polaroids (10.85 × 6.72 cm). */
export const POLAROID_PRINT_SHEET = Object.freeze({
  dpi: 300,
  widthCm: 10.85,
  heightCm: 6.72,
  maxItems: 4,
  get widthIn() {
    return cmToIn(this.widthCm);
  },
  get heightIn() {
    return cmToIn(this.heightCm);
  },
});

/** @deprecated use STRIP_PRINT_SHEET */
export const A4_LANDSCAPE = STRIP_PRINT_SHEET;

export const MAX_SHEET_ITEMS = STRIP_PRINT_SHEET.maxItems;

export function printSheetCanvasSize(sheet = STRIP_PRINT_SHEET, dpi = sheet.dpi) {
  return {
    width: Math.round(sheet.widthIn * dpi),
    height: Math.round(sheet.heightIn * dpi),
    dpi,
  };
}

/** @deprecated */
export function a4CanvasSize(dpi = STRIP_PRINT_SHEET.dpi) {
  return printSheetCanvasSize(STRIP_PRINT_SHEET, dpi);
}

function drawImageCover(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

function drawImageCoverRotated90(ctx, img, x, y, w, h) {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) return;
  const rotated = document.createElement('canvas');
  rotated.width = srcH;
  rotated.height = srcW;
  const rctx = rotated.getContext('2d');
  rctx.translate(rotated.width / 2, rotated.height / 2);
  rctx.rotate(Math.PI / 2);
  rctx.drawImage(img, -srcW / 2, -srcH / 2, srcW, srcH);
  drawImageCover(ctx, rotated, x, y, w, h);
}

function isStripFormatId(formatId) {
  return String(formatId || '').includes('2x6');
}

/** Slot width ÷ height on the A4 page for this saved item. */
function itemPageAspect(formatId, img, cfg = getConfig()) {
  if (isStripFormatId(formatId)) {
    const iw = img.naturalWidth || img.width || 600;
    const ih = img.naturalHeight || img.height || 1800;
    return ih / Math.max(1, iw);
  }
  const f = getFormat(formatId, cfg);
  if (f?.physicalSizeInches?.width && f?.physicalSizeInches?.height) {
    return f.physicalSizeInches.width / f.physicalSizeInches.height;
  }
  if (f?.canvasPx?.width && f?.canvasPx?.height) {
    return f.canvasPx.width / f.canvasPx.height;
  }
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;
  return iw / Math.max(1, ih);
}

function drawImageContain(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const scale = Math.min(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

/**
 * @param {HTMLImageElement[]|HTMLCanvasElement[]} images
 * @param {{ sheet?: typeof STRIP_PRINT_SHEET, maxItems?: number, dpi?: number, gapIn?: number, cutGuides?: boolean, background?: string }} opts
 */
export function composePrintSheet(images, opts = {}) {
  const sheet = opts.sheet || STRIP_PRINT_SHEET;
  const max = opts.maxItems ?? sheet.maxItems;
  let list = (images || []).slice(0, max);
  let formatIds = (opts.formatIds || []).slice(0, list.length);
  if (!list.length) throw new Error('Select at least one item to print.');

  if (list.length === 1) {
    list = [list[0], list[0]];
    formatIds = [formatIds[0] || '', formatIds[0] || ''];
  }

  const cfg = getConfig();
  const dpi = opts.dpi || sheet.dpi || 300;
  const width = Math.round(A4_PORTRAIT_WIDTH_IN * dpi);
  const height = Math.round(A4_PORTRAIT_HEIGHT_IN * dpi);
  const margin = Math.round((opts.marginIn ?? 0.06) * dpi);
  const gap = Math.round((opts.gapIn ?? 0.055) * dpi);
  const count = list.length;
  const usableW = width - margin * 2;
  const usableH = height - margin * 2;

  const slots = list.map((img, i) => {
    const ar = itemPageAspect(formatIds[i] || '', img, cfg);
    let slotW = usableW;
    let slotH = Math.max(1, Math.round(slotW / ar));
    return { img, formatId: formatIds[i] || '', slotW, slotH, ar };
  });

  let totalH = slots.reduce((sum, s) => sum + s.slotH, 0) + gap * (count - 1);
  if (totalH > usableH) {
    const scale = usableH / totalH;
    for (const s of slots) {
      s.slotH = Math.max(1, Math.floor(s.slotH * scale));
      s.slotW = Math.max(1, Math.floor(s.slotH * s.ar));
    }
    totalH = slots.reduce((sum, s) => sum + s.slotH, 0) + gap * (count - 1);
  }

  let startY = margin + Math.round((usableH - totalH) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = opts.background || '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const cutYs = [];
  for (let i = 0; i < count; i++) {
    const { img, formatId, slotW, slotH } = slots[i];
    const startX = Math.round((width - slotW) / 2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(startX, startY, slotW, slotH);
    ctx.clip();
    if (isStripFormatId(formatId)) {
      drawImageCoverRotated90(ctx, img, startX, startY, slotW, slotH);
    } else {
      drawImageContain(ctx, img, startX, startY, slotW, slotH);
    }
    ctx.restore();
    if (i < count - 1) {
      cutYs.push(startY + slotH + gap / 2);
    }
    startY += slotH + gap;
  }

  if (opts.cutGuides) {
    ctx.save();
    ctx.strokeStyle = 'rgba(180, 180, 180, 0.55)';
    ctx.lineWidth = Math.max(1, Math.round(dpi / 300));
    ctx.setLineDash([4, 6]);
    for (const gy of cutYs) {
      ctx.beginPath();
      ctx.moveTo(margin - gap, gy);
      ctx.lineTo(width - margin + gap, gy);
      ctx.stroke();
    }
    ctx.restore();
  }

  return canvas;
}

/** @deprecated use composePrintSheet */
export function composeA4Sheet(stripImages, opts = {}) {
  return composePrintSheet(stripImages, { ...opts, sheet: STRIP_PRINT_SHEET });
}

export async function composeStrip(shotCanvases, opts = {}) {
  const cfg = getConfig();
  const template = opts.template;
  if (!template) throw new Error('No template selected');

  const { width, height, scale } = composeSize(opts.formatId, cfg);
  const slots = scaleSlots(template.slots, scale);
  const filterId = opts.filterId || 'normal';
  const debug = opts.debugSlots ?? cfg.debugSlots;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = template.underfillColor || cfg.underfillColor || '#e8e8ec';
  ctx.fillRect(0, 0, width, height);

  const n = Math.min(shotCanvases.length, slots.length);
  for (let i = 0; i < n; i++) {
    const slot = slots[i];
    const src = shotCanvases[i];
    if (!src || !slot) continue;
    const filtered = applyFilterToCanvas(src, filterId, opts.adjustments);
    ctx.save();
    ctx.beginPath();
    ctx.rect(slot.x, slot.y, slot.w, slot.h);
    ctx.clip();
    drawCover(ctx, filtered, slot.x, slot.y, slot.w, slot.h);
    ctx.restore();
    filtered.width = 0;
    filtered.height = 0;
  }

  try {
    const img = await loadTemplateImage(template);
    if (img) ctx.drawImage(img, 0, 0, width, height);
  } catch (err) {
    console.warn(err);
    drawFallbackFrame(ctx, width, height, slots, scale, template);
  }

  // When overlap is off, redraw photos on top so confetti in holes is covered
  const confettiOverlap = opts.confettiOverlap !== false;
  if (!confettiOverlap) {
    for (let i = 0; i < n; i++) {
      const slot = slots[i];
      const src = shotCanvases[i];
      if (!src || !slot) continue;
      const filtered = applyFilterToCanvas(src, filterId, opts.adjustments);
      ctx.save();
      ctx.beginPath();
      ctx.rect(slot.x, slot.y, slot.w, slot.h);
      ctx.clip();
      drawCover(ctx, filtered, slot.x, slot.y, slot.w, slot.h);
      ctx.restore();
      filtered.width = 0;
      filtered.height = 0;
    }
  }

  if (cfg.showTimestamp) {
    ctx.fillStyle = 'rgba(250,244,230,0.55)';
    ctx.font = `${12 * scale}px sans-serif`;
    ctx.fillText(new Date().toLocaleString(), 24 * scale, height - 16 * scale);
  }

  if (opts.lockedElements?.length) {
    drawStickersOnCanvas(ctx, opts.lockedElements, scale, opts.formatId);
  }

  if (opts.stickers?.length) {
    drawStickersOnCanvas(ctx, opts.stickers, scale, opts.formatId);
  }

  if (opts.safeBounds || debug) {
    drawSafeBounds(ctx, width, height, scale);
  }

  if (debug) {
    ctx.strokeStyle = 'rgba(0,255,80,0.9)';
    ctx.lineWidth = Math.max(2, 2 * scale);
    for (const s of slots) ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);
  }

  return canvas;
}

function drawSafeBounds(ctx, width, height, scale) {
  const inset = Math.max(6, Math.round(18 * scale));
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 214, 122, 0.85)';
  ctx.lineWidth = Math.max(1.5, 1.5 * scale);
  ctx.setLineDash([8 * scale, 7 * scale]);
  ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
  ctx.restore();
}

function drawFallbackFrame(ctx, width, height, slots, scale, template) {
  ctx.strokeStyle = '#c9a227';
  ctx.lineWidth = 6 * scale;
  ctx.strokeRect(10 * scale, 10 * scale, width - 20 * scale, height - 20 * scale);
  for (const s of slots) {
    ctx.strokeRect(s.x, s.y, s.w, s.h);
  }
  ctx.fillStyle = '#c9a227';
  ctx.font = `bold ${20 * scale}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.fillText(template?.name || 'Photobooth', width / 2, height - 80 * scale);
}

export function canvasToPngBase64(canvas) {
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}

export function drawPreview(sourceCanvas, previewCanvas) {
  const ctx = previewCanvas.getContext('2d');
  previewCanvas.width = sourceCanvas.width;
  previewCanvas.height = sourceCanvas.height;
  ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  ctx.drawImage(sourceCanvas, 0, 0);
}

/** Single-item landscape print page (one cell from the cut sheet). */
export function singlePrintPageInches(formatId, cfg = getConfig()) {
  const f = formatId || '2x6';
  const isPolaroid = String(f).includes('polaroid');
  const sheet = isPolaroid ? POLAROID_PRINT_SHEET : STRIP_PRINT_SHEET;
  const pageWidthIn = sheet.widthIn / sheet.maxItems;
  const pageHeightIn = sheet.heightIn;
  return { pageWidthIn, pageHeightIn, landscape: pageWidthIn > pageHeightIn };
}
