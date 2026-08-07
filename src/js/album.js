/**
 * Photostrip album — persisted on disk in Electron (userData/album),
 * localStorage fallback in browser preview.
 */

import { composeSize } from './config.js';

export const ALBUM_STORAGE_KEY = 'photobooth-album';
export const MAX_SHEET_ITEMS = 4;
/** @deprecated */
export const MAX_A4_STRIPS = MAX_SHEET_ITEMS;
export const MAX_ALBUM_ITEMS = 40;

function useDiskAlbum() {
  return Boolean(window.photobooth?.albumList);
}

function safeParse(raw) {
  try {
    const data = JSON.parse(raw || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function persistLocal(items) {
  localStorage.setItem(ALBUM_STORAGE_KEY, JSON.stringify(items));
  return items;
}

function makeId() {
  return `strip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function loadAlbum() {
  if (useDiskAlbum()) {
    return window.photobooth.albumList();
  }
  return safeParse(localStorage.getItem(ALBUM_STORAGE_KEY));
}

/**
 * @param {{ pngBase64: string, thumbDataUrl?: string, formatId?: string, templateId?: string, photoCount?: number, label?: string }} entry
 */
export async function addStripToAlbum(entry) {
  if (!entry?.pngBase64) throw new Error('Nothing to save to album.');

  if (useDiskAlbum()) {
    const result = await window.photobooth.albumAdd(entry);
    if (result?.ok === false) {
      throw new Error(result.error || 'Could not save to album.');
    }
    return loadAlbum();
  }

  const items = safeParse(localStorage.getItem(ALBUM_STORAGE_KEY));
  const item = {
    id: makeId(),
    createdAt: new Date().toISOString(),
    formatId: entry.formatId || '2x6',
    templateId: entry.templateId || null,
    photoCount: entry.photoCount || 3,
    label: entry.label || null,
    pngBase64: entry.pngBase64,
    thumbDataUrl: entry.thumbDataUrl || `data:image/png;base64,${entry.pngBase64}`,
  };
  items.unshift(item);
  while (items.length > MAX_ALBUM_ITEMS) items.pop();

  try {
    return persistLocal(items);
  } catch (err) {
    while (items.length > 1) {
      items.pop();
      try {
        return persistLocal(items);
      } catch {
        /* keep trimming */
      }
    }
    throw new Error(
      err?.name === 'QuotaExceededError'
        ? 'Album storage is full. Delete some strips and try again.'
        : err.message || 'Could not save to album.'
    );
  }
}

export async function removeStripFromAlbum(id) {
  if (useDiskAlbum()) {
    await window.photobooth.albumRemove(id);
    return loadAlbum();
  }
  const items = safeParse(localStorage.getItem(ALBUM_STORAGE_KEY)).filter((item) => item.id !== id);
  return persistLocal(items);
}

export async function clearAlbum() {
  if (useDiskAlbum()) {
    await window.photobooth.albumClear();
    return [];
  }
  localStorage.removeItem(ALBUM_STORAGE_KEY);
  return [];
}

export async function getAlbumStrip(id) {
  const items = await loadAlbum();
  return items.find((item) => item.id === id) || null;
}

export async function getAlbumStripsByIds(ids) {
  if (useDiskAlbum() && window.photobooth.albumGetPng) {
    const meta = await loadAlbum();
    const map = new Map(meta.map((item) => [item.id, item]));
    const out = [];
    for (const id of ids || []) {
      const base = map.get(id);
      if (!base) continue;
      const pngBase64 = await window.photobooth.albumGetPng(id);
      if (!pngBase64) continue;
      out.push({ ...base, pngBase64 });
    }
    return out;
  }
  const map = new Map((await loadAlbum()).map((item) => [item.id, item]));
  return (ids || []).map((id) => map.get(id)).filter(Boolean);
}

export async function albumCount() {
  return (await loadAlbum()).length;
}

/** Build a small JPEG data-URL thumb for album grid (saves storage space). */
export async function makeAlbumThumb(pngBase64, maxHeight = 280) {
  const img = await loadPngBase64(pngBase64);
  const scale = Math.min(1, maxHeight / img.naturalHeight);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.72);
}

/**
 * Shrink a composed strip for album storage.
 * Target pixel size follows the format canvas; other aspects are preserved.
 */
export async function normalizeStripForAlbum(pngBase64, formatId = '2x6', cfg = null) {
  const size = composeSize(formatId, cfg || undefined);
  const targetW = size.baseWidthPx;
  const targetH = size.baseHeightPx;
  const img = await loadPngBase64(pngBase64);
  const ratio = img.naturalWidth / Math.max(1, img.naturalHeight);
  const targetRatio = targetW / targetH;
  let w = targetW;
  let h = targetH;
  if (Math.abs(ratio - targetRatio) > 0.08) {
    const maxEdge = Math.max(targetW, targetH);
    if (img.naturalWidth >= img.naturalHeight) {
      w = Math.min(img.naturalWidth, maxEdge * 2);
      h = Math.max(1, Math.round(w / ratio));
    } else {
      h = Math.min(img.naturalHeight, maxEdge);
      w = Math.max(1, Math.round(h * ratio));
    }
  }
  if (img.naturalWidth === w && img.naturalHeight === h) {
    return pngBase64;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}

export function loadPngBase64(pngBase64) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load strip image.'));
    img.src = `data:image/png;base64,${pngBase64}`;
  });
}
