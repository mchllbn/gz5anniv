/**
 * Template / frame registry.
 * Overlay approach: transparent slot holes + branding; photos drawn underneath.
 */

import { getConfig, resolveAssetUrl } from './config.js';

const cache = new Map();
/** Bump when template PNGs are regenerated so browsers/Electron skip stale cached frames. */
const TEMPLATE_ASSET_VERSION = '20260806-polaroid-confetti-v2';

export function listTemplates() {
  return getConfig().templates || [];
}

export function templatesForCount(photoCount) {
  return listTemplates().filter((t) => Number(t.photoCount) === Number(photoCount));
}

export function getTemplate(id) {
  return listTemplates().find((t) => t.id === id) || null;
}

export function templatesForFormatCount(formatId, photoCount) {
  return listTemplates().filter(
    (t) =>
      Number(t.photoCount) === Number(photoCount) &&
      String(t.formatId || '2x6') === String(formatId || '2x6')
  );
}

export function pickDefaultTemplate(formatId, photoCount, preferredId) {
  const compatible = templatesForFormatCount(formatId, photoCount);
  if (!compatible.length) return null;
  if (preferredId) {
    const exact = compatible.find((t) => t.id === preferredId);
    if (exact) return exact;
  }
  return compatible[0];
}

/** gold | navy | other — keep strip color when switching formats */
export function stripColorKey(template) {
  const id = String(template?.id || '').toLowerCase();
  const name = String(template?.name || '').toLowerCase();
  const under = String(template?.underfillColor || '').toLowerCase();
  if (id.includes('gold') || name.includes('gold') || under.includes('d29e') || under.includes('c9a')) {
    return 'gold';
  }
  if (
    id.includes('navy') ||
    id.includes('blue') ||
    name.includes('navy') ||
    name.includes('blue') ||
    under.includes('050b') ||
    under.includes('0c1a')
  ) {
    return 'navy';
  }
  return id || 'default';
}

export function stripColorLabel(key) {
  if (key === 'gold') return 'Gold';
  if (key === 'navy') return 'Navy';
  return key;
}

export function pickTemplateForColor(formatId, photoCount, colorKey, preferredId) {
  const compatible = templatesForFormatCount(formatId, photoCount);
  if (!compatible.length) return null;
  const colorMatches = compatible.filter((t) => stripColorKey(t) === colorKey);
  const pool = colorMatches.length ? colorMatches : compatible;
  if (preferredId) {
    const exact = pool.find((t) => t.id === preferredId);
    if (exact) return exact;
  }
  return pool[0];
}

function withCacheBust(url) {
  if (!url || String(url).startsWith('data:')) return url;
  const sep = String(url).includes('?') ? '&' : '?';
  return `${url}${sep}v=${encodeURIComponent(TEMPLATE_ASSET_VERSION)}`;
}

export async function loadTemplateImage(template) {
  if (!template?.path) return null;
  const key = `${template.id || template.path}::${TEMPLATE_ASSET_VERSION}`;
  if (cache.has(key)) return cache.get(key);

  let url = resolveAssetUrl(template.path);

  if (window.photobooth?.resolveTemplate && template.id) {
    try {
      url = await window.photobooth.resolveTemplate(template.id);
    } catch {
      /* fall through */
    }
  } else if (window.photobooth?.readFileDataUrl && template._absPath) {
    url = await window.photobooth.readFileDataUrl(template._absPath);
  }

  const img = await loadImage(withCacheBust(url));
  cache.set(key, img);
  return img;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load template: ${src}`));
    img.src = src;
  });
}

export function clearTemplateCache() {
  cache.clear();
}

/** Tiny canvas preview of a frame (empty slots). */
export async function frameThumb(template, w = 90, h = 270) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = template.underfillColor || '#e8e8ec';
  ctx.fillRect(0, 0, w, h);
  try {
    const img = await loadTemplateImage(template);
    if (img) {
      const scale = Math.min(w / img.width, h / img.height);
      const rw = img.width * scale;
      const rh = img.height * scale;
      const ox = (w - rw) / 2;
      const oy = (h - rh) / 2;
      ctx.drawImage(img, ox, oy, rw, rh);
    }
  } catch {
    ctx.strokeStyle = '#c9a227';
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = '#c9a227';
    ctx.font = '10px sans-serif';
    ctx.fillText(template.name || template.id, 8, h - 10);
  }
  return canvas;
}
