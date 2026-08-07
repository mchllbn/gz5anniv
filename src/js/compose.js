/**
 * Strip composition.
 *
 * Template mode: **overlay**
 * 1. Underfill
 * 2. Photos into slots (object-fit: cover)
 * 3. Template PNG on top (transparent holes + branding + optional confetti in holes)
 * 4. Photos redrawn on top so hole confetti never overlaps shots
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

export const MAX_STRIP_SHEET_ITEMS = 4;
export const MAX_POLAROID_SHEET_ITEMS = 8;
export const MAX_LANDSCAPE_SHEET_ITEMS = 4;
/** Highest selectable count across sheet types. */
export const MAX_SHEET_ITEMS = MAX_POLAROID_SHEET_ITEMS;

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

/** Landscape cut sheet — legacy polaroid pack size (unused for A4 grid). */
export const POLAROID_PRINT_SHEET = Object.freeze({
  dpi: 300,
  widthCm: 10.85,
  heightCm: 6.72,
  maxItems: 8,
  get widthIn() {
    return cmToIn(this.widthCm);
  },
  get heightIn() {
    return cmToIn(this.heightCm);
  },
});

/** A4 portrait — 2×2 grid of 6×4 landscape sheets (4×6 / four-up). */
export const LANDSCAPE_SHEET_PRINT_SHEET = Object.freeze({
  dpi: 300,
  maxItems: MAX_LANDSCAPE_SHEET_ITEMS,
  widthCm: 21,
  heightCm: 29.7,
  get widthIn() {
    return cmToIn(this.widthCm);
  },
  get heightIn() {
    return cmToIn(this.heightCm);
  },
});

/** @deprecated alias — use LANDSCAPE_SHEET_PRINT_SHEET */
export const SHEET_PRINT_SHEET = LANDSCAPE_SHEET_PRINT_SHEET;

/** @deprecated use STRIP_PRINT_SHEET */
export const A4_LANDSCAPE = STRIP_PRINT_SHEET;

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

function isPolaroidFormatId(formatId) {
  return String(formatId || '').includes('polaroid');
}

function isLandscapeSheetFormatId(formatId) {
  const id = String(formatId || '').toLowerCase();
  return id === '4x6' || id === '6x4-four';
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
 * A4 portrait sheet — up to four 2×6″ strips laid horizontal in equal rows.
 * Matches the cut template: stacked landscape slots with dashed cut guides.
 */
export function composeStripA4Sheet(images, opts = {}) {
  const list = (images || []).slice(0, 4);
  if (!list.length) throw new Error('Select at least one 2×6 strip to print.');

  const dpi = opts.dpi || 300;
  const width = Math.round(A4_PORTRAIT_WIDTH_IN * dpi);
  const height = Math.round(A4_PORTRAIT_HEIGHT_IN * dpi);
  const margin = Math.round((opts.marginIn ?? 0.35) * dpi);
  const gap = Math.round((opts.gapIn ?? 0.18) * dpi);
  const rows = 4;
  const usableW = width - margin * 2;
  const usableH = height - margin * 2;
  // Rotated 2×6″ → 6″ wide × 2″ tall (3:1)
  const stripAr = 3;
  let slotH = Math.floor((usableH - gap * (rows - 1)) / rows);
  let slotW = Math.floor(slotH * stripAr);
  if (slotW > usableW) {
    slotW = usableW;
    slotH = Math.floor(slotW / stripAr);
  }
  const stackH = slotH * rows + gap * (rows - 1);
  const startX = Math.round((width - slotW) / 2);
  let startY = margin + Math.round((usableH - stackH) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = opts.background || '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const cutGuides = opts.cutGuides !== false;
  for (let i = 0; i < rows; i++) {
    const y = startY + i * (slotH + gap);
    const img = list[i];
    if (img) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(startX, y, slotW, slotH);
      ctx.clip();
      drawImageCoverRotated90(ctx, img, startX, y, slotW, slotH);
      ctx.restore();
    }
    if (cutGuides) {
      ctx.save();
      ctx.strokeStyle = 'rgba(40, 40, 40, 0.55)';
      ctx.lineWidth = Math.max(1, Math.round(dpi / 220));
      ctx.setLineDash([Math.round(dpi * 0.04), Math.round(dpi * 0.035)]);
      ctx.strokeRect(startX + 0.5, y + 0.5, slotW - 1, slotH - 1);
      ctx.restore();
    }
  }

  return canvas;
}

/**
 * A4 portrait sheet — up to eight polaroids in a fixed 2×4 grid.
 * Portrait slots keep the 4×6 (2:3) aspect, flush-packed with dashed cut guides
 * inside a printer “danger zone” margin.
 */
export function composePolaroidA4Sheet(images, opts = {}) {
  const list = (images || []).slice(0, MAX_POLAROID_SHEET_ITEMS);
  if (!list.length) throw new Error('Select at least one polaroid to print.');

  const dpi = opts.dpi || 300;
  const width = Math.round(A4_PORTRAIT_WIDTH_IN * dpi);
  const height = Math.round(A4_PORTRAIT_HEIGHT_IN * dpi);
  // ~10 mm non-print / trim margin (danger zone)
  const margin = Math.round((opts.marginIn ?? 0.4) * dpi);
  const cols = 2;
  const rows = 4;
  const polaroidAr = 4 / 6; // width ÷ height

  const usableW = width - margin * 2;
  const usableH = height - margin * 2;

  // Flush slots — no gutters; dashed lines are cut guides only
  let slotW = Math.floor(usableW / cols);
  let slotH = Math.floor(slotW / polaroidAr);
  if (slotH * rows > usableH) {
    slotH = Math.floor(usableH / rows);
    slotW = Math.floor(slotH * polaroidAr);
  }
  const gridW = slotW * cols;
  const gridH = slotH * rows;
  const startX = Math.round((width - gridW) / 2);
  const startY = Math.round((height - gridH) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = opts.background || '#ffffff';
  ctx.fillRect(0, 0, width, height);

  if (opts.dangerZone === true) {
    ctx.fillStyle = 'rgba(255, 170, 170, 0.28)';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = opts.background || '#ffffff';
    ctx.fillRect(startX, startY, gridW, gridH);
  }

  for (let i = 0; i < cols * rows; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * slotW;
    const y = startY + row * slotH;
    const img = list[i];
    if (!img) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, slotW, slotH);
    ctx.clip();
    drawImageCover(ctx, img, x, y, slotW, slotH);
    ctx.restore();
  }

  const cutGuides = opts.cutGuides !== false;
  if (cutGuides) {
    const lw = Math.max(1, Math.round(dpi / 220));
    const dash = [Math.round(dpi * 0.04), Math.round(dpi * 0.035)];

    ctx.save();
    ctx.strokeStyle = 'rgba(40, 40, 40, 0.55)';
    ctx.lineWidth = lw;
    ctx.setLineDash(dash);
    ctx.strokeRect(startX + 0.5, startY + 0.5, gridW - 1, gridH - 1);
    for (let c = 1; c < cols; c++) {
      const x = startX + c * slotW;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, startY);
      ctx.lineTo(x + 0.5, startY + gridH);
      ctx.stroke();
    }
    for (let r = 1; r < rows; r++) {
      const y = startY + r * slotH;
      ctx.beginPath();
      ctx.moveTo(startX, y + 0.5);
      ctx.lineTo(startX + gridW, y + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  return canvas;
}

/**
 * A4 portrait — up to four 6×4 landscape sheets in a fixed 2×2 grid.
 * Fills down the left column first (then right), matching the cut template.
 * Formats: 4×6 sheet and 6×4 four-up (same 3:2 landscape aspect).
 */
export function composeLandscapeSheetA4Sheet(images, opts = {}) {
  const list = (images || []).slice(0, MAX_LANDSCAPE_SHEET_ITEMS);
  if (!list.length) throw new Error('Select at least one 4×6 / four-up sheet to print.');

  const dpi = opts.dpi || 300;
  const width = Math.round(A4_PORTRAIT_WIDTH_IN * dpi);
  const height = Math.round(A4_PORTRAIT_HEIGHT_IN * dpi);
  const margin = Math.round((opts.marginIn ?? 0.4) * dpi);
  const cols = 2;
  const rows = 2;
  const landscapeAr = 6 / 4; // width ÷ height (6×4″)

  const usableW = width - margin * 2;
  const usableH = height - margin * 2;

  let slotW = Math.floor(usableW / cols);
  let slotH = Math.floor(slotW / landscapeAr);
  if (slotH * rows > usableH) {
    slotH = Math.floor(usableH / rows);
    slotW = Math.floor(slotH * landscapeAr);
  }
  const gridW = slotW * cols;
  const gridH = slotH * rows;
  const startX = Math.round((width - gridW) / 2);
  const startY = Math.round((height - gridH) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = opts.background || '#ffffff';
  ctx.fillRect(0, 0, width, height);

  if (opts.dangerZone === true) {
    ctx.fillStyle = 'rgba(255, 170, 170, 0.28)';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = opts.background || '#ffffff';
    ctx.fillRect(startX, startY, gridW, gridH);
  }

  const slotCount = cols * rows;
  for (let i = 0; i < slotCount; i++) {
    const col = Math.floor(i / rows);
    const row = i % rows;
    const x = startX + col * slotW;
    const y = startY + row * slotH;
    const img = list[i];
    if (!img) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, slotW, slotH);
    ctx.clip();
    drawImageCover(ctx, img, x, y, slotW, slotH);
    ctx.restore();
  }

  const cutGuides = opts.cutGuides !== false;
  if (cutGuides) {
    const lw = Math.max(1, Math.round(dpi / 220));
    const dash = [Math.round(dpi * 0.04), Math.round(dpi * 0.035)];

    ctx.save();
    ctx.strokeStyle = 'rgba(40, 40, 40, 0.55)';
    ctx.lineWidth = lw;
    ctx.setLineDash(dash);
    ctx.strokeRect(startX + 0.5, startY + 0.5, gridW - 1, gridH - 1);
    for (let c = 1; c < cols; c++) {
      const x = startX + c * slotW;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, startY);
      ctx.lineTo(x + 0.5, startY + gridH);
      ctx.stroke();
    }
    for (let r = 1; r < rows; r++) {
      const y = startY + r * slotH;
      ctx.beginPath();
      ctx.moveTo(startX, y + 0.5);
      ctx.lineTo(startX + gridW, y + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  return canvas;
}

/**
 * @param {HTMLImageElement[]|HTMLCanvasElement[]} images
 * @param {{ sheet?: typeof STRIP_PRINT_SHEET, maxItems?: number, dpi?: number, gapIn?: number, cutGuides?: boolean, background?: string, formatIds?: string[], stripA4?: boolean, polaroidA4?: boolean, landscapeSheetA4?: boolean }} opts
 */
export function composePrintSheet(images, opts = {}) {
  const formatIds = opts.formatIds || [];
  const allStrips =
    images?.length > 0 &&
    (opts.stripA4 === true ||
      (formatIds.length === images.length && formatIds.every((id) => isStripFormatId(id))));
  if (allStrips && opts.stripA4 !== false && opts.polaroidA4 !== true) {
    return composeStripA4Sheet(images, opts);
  }
  const allPolaroids =
    images?.length > 0 &&
    (opts.polaroidA4 === true ||
      (formatIds.length === images.length && formatIds.every((id) => isPolaroidFormatId(id))));
  if (allPolaroids && opts.polaroidA4 !== false && opts.landscapeSheetA4 !== true) {
    return composePolaroidA4Sheet(images, opts);
  }
  const allLandscapeSheets =
    images?.length > 0 &&
    (opts.landscapeSheetA4 === true ||
      (formatIds.length === images.length &&
        formatIds.every((id) => isLandscapeSheetFormatId(id))));
  if (allLandscapeSheets && opts.landscapeSheetA4 !== false) {
    return composeLandscapeSheetA4Sheet(images, opts);
  }

  const sheet = opts.sheet || STRIP_PRINT_SHEET;
  const max = opts.maxItems ?? sheet.maxItems;
  let list = (images || []).slice(0, max);
  let ids = formatIds.slice(0, list.length);
  if (!list.length) throw new Error('Select at least one item to print.');

  if (list.length === 1) {
    list = [list[0], list[0]];
    ids = [ids[0] || '', ids[0] || ''];
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
    const ar = itemPageAspect(ids[i] || '', img, cfg);
    let slotW = usableW;
    let slotH = Math.max(1, Math.round(slotW / ar));
    return { img, formatId: ids[i] || '', slotW, slotH, ar };
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
  const brandOverlap = Math.max(0, Math.round((Number(template.brandOverlapPx) || 0) * scale));
  let bottomSlotIndex = -1;
  if (brandOverlap > 0 && slots.length) {
    let maxBottom = -Infinity;
    for (let i = 0; i < slots.length; i++) {
      const b = (slots[i]?.y || 0) + (slots[i]?.h || 0);
      if (b >= maxBottom) {
        maxBottom = b;
        bottomSlotIndex = i;
      }
    }
  }

  const softFrames = template.softSlotFrames === true;
  // Bleed under frame lips so slot rounding never leaves a hairline gap
  const frameBleed = Math.max(1, Math.round((softFrames ? 1.5 : 1) * scale));

  const drawPhotoInSlot = (slot, src) => {
    const filtered = applyFilterToCanvas(src, filterId, opts.adjustments);
    const x = slot.x - frameBleed;
    const y = slot.y - frameBleed;
    const w = slot.w + frameBleed * 2;
    const h = slot.h + frameBleed * 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    drawCover(ctx, filtered, x, y, w, h);
    ctx.restore();
    filtered.width = 0;
    filtered.height = 0;
  };

  for (let i = 0; i < n; i++) {
    const slot = slots[i];
    const src = shotCanvases[i];
    if (!src || !slot) continue;
    drawPhotoInSlot(slot, src);
  }

  let templateImg = null;
  try {
    templateImg = await loadTemplateImage(template);
    if (templateImg) ctx.drawImage(templateImg, 0, 0, width, height);
  } catch (err) {
    console.warn(err);
    drawFallbackFrame(ctx, width, height, slots, scale, template);
  }

  // Photos fill the full template holes (no inset / no empty “cut” band)
  for (let i = 0; i < n; i++) {
    const slot = slots[i];
    const src = shotCanvases[i];
    if (!src || !slot) continue;
    drawPhotoInSlot(slot, src);
  }

  // Re-lay overlapping brand (e.g. Polaroid 20 mark) on top of the photo — no navy gap
  if (templateImg && brandOverlap > 0 && bottomSlotIndex >= 0) {
    const slot = slots[bottomSlotIndex];
    if (slot) {
      const y0 = Math.max(slot.y, slot.y + slot.h - brandOverlap);
      const bandH = slot.y + slot.h - y0;
      if (bandH > 0) {
        const nw = templateImg.naturalWidth || width;
        const nh = templateImg.naturalHeight || height;
        const sy = (y0 / height) * nh;
        const sh = (bandH / height) * nh;
        ctx.drawImage(templateImg, 0, sy, nw, sh, 0, y0, width, bandH);
      }
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
