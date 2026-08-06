/**
 * Canvas/CSS-style filters baked into bitmaps.
 */

export const FILTERS = [
  {
    id: 'natural',
    label: 'Natural',
    css: 'none',
    apply(ctx) {
      /* no-op */
    },
  },
  {
    id: 'mono',
    label: 'Mono',
    css: 'grayscale(1)',
    apply(ctx, w, h) {
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        d[i] = d[i + 1] = d[i + 2] = g;
      }
      ctx.putImageData(img, 0, 0);
    },
  },
  {
    id: 'noir',
    label: 'Noir',
    css: 'grayscale(1) contrast(1.22) brightness(0.96)',
    apply(ctx, w, h) {
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        g = (g - 128) * 1.22 + 128;
        d[i] = d[i + 1] = d[i + 2] = clamp(g);
      }
      ctx.putImageData(img, 0, 0);
    },
  },
  {
    id: 'warm',
    label: 'Warm',
    css: 'saturate(1.08)',
    apply(ctx, w, h) {
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = clamp(d[i] * 1.08 + 8);
        d[i + 1] = clamp(d[i + 1] * 1.02 + 3);
        d[i + 2] = clamp(d[i + 2] * 0.93);
      }
      ctx.putImageData(img, 0, 0);
    },
  },
  {
    id: 'cool',
    label: 'Cool',
    css: 'saturate(1.02)',
    apply(ctx, w, h) {
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = clamp(d[i] * 0.94);
        d[i + 1] = clamp(d[i + 1] * 1.01 + 4);
        d[i + 2] = clamp(d[i + 2] * 1.1 + 8);
      }
      ctx.putImageData(img, 0, 0);
    },
  },
  {
    id: 'vivid',
    label: 'Vivid',
    css: 'saturate(1.24)',
    apply(ctx, w, h) {
      applyContrastSat(ctx, w, h, 1.07, 1.22);
    },
  },
  {
    id: 'fade',
    label: 'Fade',
    css: 'contrast(0.9) saturate(0.86)',
    apply(ctx, w, h) {
      applyContrastSat(ctx, w, h, 0.9, 0.86, 8);
    },
  },
  {
    id: 'dramatic',
    label: 'Dramatic',
    css: 'contrast(1.2)',
    apply(ctx, w, h) {
      applyContrastSat(ctx, w, h, 1.2, 1.02, -6);
    },
  },
  {
    id: 'glam',
    label: 'Glam',
    css: 'contrast(1.08) brightness(1.03)',
    apply(ctx, w, h) {
      const original = ctx.getImageData(0, 0, w, h);
      const soft = document.createElement('canvas');
      soft.width = w;
      soft.height = h;
      const sctx = soft.getContext('2d');
      sctx.filter = 'blur(2.3px) brightness(1.03)';
      sctx.drawImage(ctx.canvas, 0, 0);
      const blurred = sctx.getImageData(0, 0, w, h);
      const d = original.data;
      const b = blurred.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = d[i] * 0.68 + b[i] * 0.32;
        d[i + 1] = d[i + 1] * 0.68 + b[i + 1] * 0.32;
        d[i + 2] = d[i + 2] * 0.68 + b[i + 2] * 0.32;
      }
      ctx.putImageData(original, 0, 0);
      applyContrastSat(ctx, w, h, 1.08, 1.04, 3);
    },
  },
  {
    id: 'vintage',
    label: 'Vintage',
    css: 'contrast(1.1) sepia(0.35) saturate(1.15)',
    apply(ctx, w, h) {
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        let r = (d[i] - 128) * 1.1 + 128;
        let g = (d[i + 1] - 128) * 1.1 + 128;
        let b = (d[i + 2] - 128) * 1.06 + 128;
        r = r * 1.07 + 10;
        g = g * 1.01 + 5;
        b = b * 0.9;
        d[i] = clamp(r);
        d[i + 1] = clamp(g);
        d[i + 2] = clamp(b);
      }
      ctx.putImageData(img, 0, 0);
    },
  },
];

/** Slider values (0 = neutral). Applied after the selected effect preset. */
export const DEFAULT_ADJUSTMENTS = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  exposure: 0,
  warmth: 0,
  shadows: 0,
  highlights: 0,
};

export const ADJUST_CONTROLS = [
  { key: 'brightness', label: 'Brightness', min: -50, max: 50, step: 1 },
  { key: 'contrast', label: 'Contrast', min: -50, max: 50, step: 1 },
  { key: 'saturation', label: 'Saturation', min: -80, max: 80, step: 1 },
  { key: 'exposure', label: 'Exposure', min: -40, max: 40, step: 1 },
  { key: 'warmth', label: 'Warmth', min: -40, max: 40, step: 1 },
  { key: 'shadows', label: 'Shadows', min: 0, max: 45, step: 1 },
  { key: 'highlights', label: 'Highlights', min: -45, max: 45, step: 1 },
];

function clamp(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function normalizeAdjustments(raw) {
  const out = { ...DEFAULT_ADJUSTMENTS };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(DEFAULT_ADJUSTMENTS)) {
    const spec = ADJUST_CONTROLS.find((c) => c.key === key);
    if (!spec) continue;
    const n = Number(raw[key]);
    if (!Number.isFinite(n)) continue;
    out[key] = Math.max(spec.min, Math.min(spec.max, Math.round(n)));
  }
  return out;
}

export function hasActiveAdjustments(adj) {
  const n = normalizeAdjustments(adj);
  return Object.keys(DEFAULT_ADJUSTMENTS).some((k) => n[k] !== DEFAULT_ADJUSTMENTS[k]);
}

function applyAdjustments(ctx, w, h, adj) {
  const a = normalizeAdjustments(adj);
  const brMul = 1 + a.brightness / 100;
  const conMul = 1 + a.contrast / 100;
  const satMul = 1 + a.saturation / 100;
  const exp = a.exposure * 0.85;
  const warm = a.warmth;
  const shadowLift = a.shadows;
  const hi = a.highlights;

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];

    r = (r - 128) * conMul + 128;
    g = (g - 128) * conMul + 128;
    b = (b - 128) * conMul + 128;

    r *= brMul;
    g *= brMul;
    b *= brMul;

    r += exp;
    g += exp;
    b += exp;

    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = gray + (r - gray) * satMul;
    g = gray + (g - gray) * satMul;
    b = gray + (b - gray) * satMul;

    r += warm * 0.55;
    g += warm * 0.12;
    b -= warm * 0.45;

    const lum = (r + g + b) / 3;
    if (shadowLift > 0 && lum < 140) {
      const t = (140 - lum) / 140;
      const lift = shadowLift * t;
      r += lift;
      g += lift;
      b += lift;
    }
    if (hi !== 0 && lum > 115) {
      const t = (lum - 115) / 140;
      const mul = 1 + hi / 100;
      r = 115 + (r - 115) * mul;
      g = 115 + (g - 115) * mul;
      b = 115 + (b - 115) * mul;
    }

    d[i] = clamp(r);
    d[i + 1] = clamp(g);
    d[i + 2] = clamp(b);
  }

  ctx.putImageData(img, 0, 0);
}

export function getFilter(id) {
  const alias = id === 'normal' ? 'natural' : id === 'grayscale' ? 'mono' : id === 'sepia' ? 'warm' : id;
  return FILTERS.find((f) => f.id === alias) || FILTERS[0];
}

/** Return a new canvas with filter + adjustments baked in. */
export function applyFilterToCanvas(sourceCanvas, filterId, adjustments) {
  const filter = getFilter(filterId);
  const out = document.createElement('canvas');
  out.width = sourceCanvas.width;
  out.height = sourceCanvas.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0);
  if (filter.id !== 'natural') {
    filter.apply(ctx, out.width, out.height);
  }
  if (hasActiveAdjustments(adjustments)) {
    applyAdjustments(ctx, out.width, out.height, adjustments);
  }
  return out;
}

function applyContrastSat(ctx, w, h, contrastMul = 1, satMul = 1, lift = 0) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = (d[i] - 128) * contrastMul + 128 + lift;
    let g = (d[i + 1] - 128) * contrastMul + 128 + lift;
    let b = (d[i + 2] - 128) * contrastMul + 128 + lift;
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = gray + (r - gray) * satMul;
    g = gray + (g - gray) * satMul;
    b = gray + (b - gray) * satMul;
    d[i] = clamp(r);
    d[i + 1] = clamp(g);
    d[i + 2] = clamp(b);
  }
  ctx.putImageData(img, 0, 0);
}

/** Draw a filtered thumbnail into a target canvas (fit cover). */
export function drawFilterThumb(sourceCanvas, targetCanvas, filterId) {
  const filtered = applyFilterToCanvas(sourceCanvas, filterId);
  const ctx = targetCanvas.getContext('2d');
  const tw = targetCanvas.width;
  const th = targetCanvas.height;
  ctx.clearRect(0, 0, tw, th);
  drawCover(ctx, filtered, 0, 0, tw, th);
  return filtered;
}

export function drawCover(ctx, source, dx, dy, dw, dh) {
  const sw = source.width;
  const sh = source.height;
  const scale = Math.max(dw / sw, dh / sh);
  const rw = sw * scale;
  const rh = sh * scale;
  const ox = dx + (dw - rw) / 2;
  const oy = dy + (dh - rh) / 2;
  ctx.drawImage(source, ox, oy, rw, rh);
}
