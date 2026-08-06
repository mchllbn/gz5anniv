/**
 * Strip composition.
 *
 * Template mode: **overlay**
 * 1. Underfill
 * 2. Photos into slots (object-fit: cover)
 * 3. Template PNG on top (transparent holes + branding + optional confetti in holes)
 * 4. If confettiOverlap is false, photos are redrawn on top to cover hole confetti
 */

import { composeSize, scaleSlots, getConfig } from './config.js';
import { applyFilterToCanvas, drawCover } from './filters.js';
import { loadTemplateImage } from './frames.js';
import { drawStickersOnCanvas } from './stickers.js';

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
