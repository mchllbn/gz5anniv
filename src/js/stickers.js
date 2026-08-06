/**
 * Personalization model for strip stickers/text placed on format base coords.
 * Base comes from `formats[].canvasPx` (e.g. 2x6 => 600×1800, 4x6 landscape => 1800×1200).
 */

import { getConfig } from './config.js';

export const STICKER_BASE = { width: 600, height: 1800 };
export const STICKER_CATEGORIES = ['Anniversary', 'Party', 'Props', 'Text', 'Brand'];

export const STICKER_CATALOG = [
  { id: 'star-gold', label: 'Gold star', category: 'Anniversary', kind: 'draw', draw: drawGoldStar },
  { id: 'sparkle', label: 'Sparkle', category: 'Anniversary', kind: 'draw', draw: drawSparkle },
  { id: 'heart', label: 'Heart', category: 'Party', kind: 'draw', draw: drawHeart },
  { id: 'shield', label: 'Shield', category: 'Brand', kind: 'draw', draw: drawShield },
  { id: 'badge-20', label: '20 Years', category: 'Anniversary', kind: 'text', text: '20 YEARS', color: '#e8c547' },
  { id: 'badge-excellence', label: 'Excellence', category: 'Brand', kind: 'text', text: 'EXCELLENCE', color: '#faf4e6' },
  { id: 'emoji-party', label: 'Party', category: 'Party', kind: 'emoji', char: '🎉' },
  { id: 'emoji-heart', label: 'Love', category: 'Party', kind: 'emoji', char: '❤️' },
  { id: 'emoji-star', label: 'Star', category: 'Anniversary', kind: 'emoji', char: '⭐' },
  { id: 'emoji-camera', label: 'Camera', category: 'Props', kind: 'emoji', char: '📸' },
  { id: 'emoji-sparkles', label: 'Sparkles', category: 'Props', kind: 'emoji', char: '✨' },
  { id: 'emoji-clink', label: 'Cheers', category: 'Party', kind: 'emoji', char: '🥂' },
];

const STICKER_INDEX = new Map(STICKER_CATALOG.map((s) => [s.id, s]));

export function getStickerDef(id) {
  return STICKER_INDEX.get(id) || null;
}

export function stickersByCategory(category = 'All') {
  if (!category || category === 'All') return STICKER_CATALOG;
  return STICKER_CATALOG.filter((s) => s.category === category);
}

export function createLockedBrandElements(formatId = '2x6') {
  // Anniversary templates already include the 20 Years mark + agency seal in the art.
  void formatId;
  return [];
}

/**
 * Fixed decoration anchors (photo-corner accents). Stickers drop into the next
 * open slot and stay put — no freeform drag/resize.
 * Coordinates are in format canvas space (2x6 = 600×1800, 4x6 = 1800×1200).
 */
const STICKER_SLOTS = {
  '2x6': [
    { x: 500, y: 85, size: 0.92, rotation: -8 },
    { x: 100, y: 390, size: 0.88, rotation: 10 },
    { x: 500, y: 500, size: 0.92, rotation: 7 },
    { x: 100, y: 800, size: 0.88, rotation: -9 },
    { x: 500, y: 920, size: 0.92, rotation: -6 },
    { x: 100, y: 1200, size: 0.88, rotation: 8 },
  ],
  '4x6': [
    { x: 820, y: 90, size: 1.05, rotation: -7 },
    { x: 120, y: 510, size: 1.0, rotation: 8 },
    { x: 1680, y: 90, size: 1.05, rotation: 6 },
    { x: 1000, y: 510, size: 1.0, rotation: -8 },
    { x: 1680, y: 680, size: 1.05, rotation: -5 },
    { x: 1000, y: 1080, size: 1.0, rotation: 7 },
  ],
  '4x6-polaroid': [
    { x: 600, y: 1580, size: 0.9, rotation: -4 },
    { x: 200, y: 1600, size: 0.75, rotation: 6 },
    { x: 1000, y: 1600, size: 0.75, rotation: -5 },
  ],
  '6x4-four': [
    { x: 200, y: 1000, size: 0.85, rotation: -6 },
    { x: 900, y: 200, size: 0.8, rotation: 5 },
    { x: 1600, y: 200, size: 0.85, rotation: -4 },
    { x: 1400, y: 1000, size: 0.85, rotation: 4 },
  ],
};

export function stickerSlotsForFormat(formatId = '2x6') {
  return STICKER_SLOTS[formatId] || STICKER_SLOTS['2x6'];
}

/** First unused fixed slot, or null when every decoration spot is filled. */
export function nextStickerSlot(placements, formatId = '2x6') {
  const slots = stickerSlotsForFormat(formatId);
  const used = new Set(
    (Array.isArray(placements) ? placements : [])
      .filter((p) => p && !p.locked && p.slotIndex != null)
      .map((p) => Number(p.slotIndex))
  );
  for (let i = 0; i < slots.length; i++) {
    if (used.has(i)) continue;
    const s = slots[i];
    return {
      slotIndex: i,
      x: s.x,
      y: s.y,
      size: s.size,
      rotation: s.rotation,
      flipX: false,
      locked: false,
    };
  }
  return null;
}

/** @deprecated Prefer nextStickerSlot — kept for call-site compatibility. */
export function autoStickerPlacement(placementIndex, formatId = '2x6') {
  const slots = stickerSlotsForFormat(formatId);
  const i = Math.max(0, Number(placementIndex) || 0) % slots.length;
  const s = slots[i];
  return {
    slotIndex: i,
    x: s.x,
    y: s.y,
    size: s.size,
    rotation: s.rotation,
    flipX: false,
    locked: false,
  };
}

function placementId() {
  return `pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizePlacements(list, formatId = '2x6') {
  if (!Array.isArray(list)) return [];
  const base = baseForFormat(formatId);
  return list
    .filter((p) => p && (p.type === 'text' || getStickerDef(p.stickerId)))
    .map((p, idx) => ({
      id: p.id || `${placementId()}-${idx}`,
      stickerId: p.stickerId || null,
      type: p.type === 'text' ? 'text' : 'sticker',
      text: String(p.text || ''),
      color: p.color || '#f8f2df',
      x: clampNum(p.x, 0, base.width),
      y: clampNum(p.y, 0, base.height),
      size: clampNum(p.size ?? 1, 0.35, 2.8),
      rotation: Number(p.rotation) || 0,
      flipX: Boolean(p.flipX),
      locked: Boolean(p.locked),
      slotIndex: p.slotIndex == null || p.locked ? null : Math.max(0, Number(p.slotIndex) || 0),
      category: p.category || getStickerDef(p.stickerId)?.category || 'Text',
    }));
}

function clampNum(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function baseForFormat(formatId = '2x6', cfg = getConfig()) {
  const f = Array.isArray(cfg?.formats) ? cfg.formats.find((x) => x.id === formatId) : null;
  return f?.canvasPx || STICKER_BASE;
}

function drawGoldStar(ctx, size) {
  const r = size * 0.45;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.42;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = '#e8c547';
  ctx.fill();
  ctx.strokeStyle = '#6b5420';
  ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.stroke();
}

function drawSparkle(ctx, size) {
  const r = size * 0.55;
  const thin = Math.max(1.5, size * 0.035);
  const thick = Math.max(2, size * 0.06);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = thick;
  ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
  ctx.shadowBlur = size * 0.12;
  for (let a = 0; a < 8; a++) {
    const ang = (a * Math.PI) / 4;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    ctx.beginPath();
    ctx.moveTo(cos * r * 0.15, sin * r * 0.15);
    ctx.lineTo(cos * r, sin * r);
    ctx.stroke();
  }
  ctx.lineWidth = thin;
  ctx.beginPath();
  ctx.moveTo(-r * 0.75, -r * 0.75);
  ctx.lineTo(r * 0.75, r * 0.75);
  ctx.moveTo(r * 0.75, -r * 0.75);
  ctx.lineTo(-r * 0.75, r * 0.75);
  ctx.stroke();
  ctx.shadowBlur = 0;
  const core = size * 0.14;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(0, 0, core, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(232, 197, 71, 0.85)';
  ctx.beginPath();
  ctx.arc(0, 0, core * 0.55, 0, Math.PI * 2);
  ctx.fill();
}

function drawHeart(ctx, size) {
  const s = size * 0.38;
  ctx.fillStyle = '#e85d6a';
  ctx.beginPath();
  ctx.moveTo(0, s * 0.35);
  ctx.bezierCurveTo(-s, -s * 0.35, -s * 0.9, s * 0.55, 0, s * 1.1);
  ctx.bezierCurveTo(s * 0.9, s * 0.55, s, -s * 0.35, 0, s * 0.35);
  ctx.fill();
  ctx.strokeStyle = '#8a3040';
  ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.stroke();
}

function drawShield(ctx, size) {
  const w = size * 0.42;
  const h = size * 0.5;
  ctx.fillStyle = '#c9a227';
  ctx.strokeStyle = '#5c4818';
  ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.beginPath();
  ctx.moveTo(0, -h);
  ctx.lineTo(w, -h * 0.35);
  ctx.lineTo(w, h * 0.25);
  ctx.quadraticCurveTo(0, h * 0.95, -w, h * 0.25);
  ctx.lineTo(-w, -h * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

export function drawSticker(ctx, def, pixelSize, rotationDeg = 0) {
  if (!def) return;
  ctx.save();
  ctx.rotate((rotationDeg * Math.PI) / 180);
  const size = pixelSize;

  if (def.kind === 'emoji') {
    ctx.font = `${Math.round(size * 0.9)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.char, 0, 0);
  } else if (def.kind === 'text') {
    const fontSize = Math.round(size * 0.22);
    ctx.font = `600 ${fontSize}px Cinzel, Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = def.color || '#e8c547';
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = Math.max(1, fontSize * 0.08);
    ctx.strokeText(def.text, 0, 0);
    ctx.fillText(def.text, 0, 0);
  } else if (def.kind === 'draw' && def.draw) {
    def.draw(ctx, size);
  }

  ctx.restore();
}

function drawTextPlacement(ctx, placement, pixelSize) {
  const text = String(placement.text || '').trim();
  if (!text) return;
  const fontSize = Math.round(pixelSize * 0.24);
  ctx.font = `700 ${fontSize}px Cinzel, Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = placement.color || '#f8f2df';
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = Math.max(1, fontSize * 0.08);
  ctx.strokeText(text.slice(0, 20), 0, 0);
  ctx.fillText(text.slice(0, 20), 0, 0);
}

/** Draw all placements on the composed strip (scaled canvas). */
export function drawStickersOnCanvas(ctx, placements, canvasScale, formatId = '2x6') {
  const list = normalizePlacements(placements, formatId);
  const base = 72 * (baseForFormat(formatId).width / STICKER_BASE.width);
  for (const p of list) {
    const def = getStickerDef(p.stickerId);
    const px = p.x * canvasScale;
    const py = p.y * canvasScale;
    const size = base * p.size * canvasScale;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate((p.rotation * Math.PI) / 180);
    if (p.flipX) ctx.scale(-1, 1);
    if (p.type === 'text') {
      drawTextPlacement(ctx, p, size);
    } else if (def) {
      drawSticker(ctx, def, size, 0);
    }
    ctx.restore();
  }
}

/** Thumbnail for picker button. */
export function stickerThumbCanvas(def, w = 44, h = 44) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  drawSticker(ctx, def, Math.min(w, h) * 0.85, 0);
  return c;
}
