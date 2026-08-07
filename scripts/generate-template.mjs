/**
 * Generate blank overlay templates:
 * - strip-blank.png from sample (3-shot primary)
 * - strip-1/2/4.png with logo footer for other counts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const tplDir = path.join(root, 'assets', 'templates');
const texDir = path.join(root, 'assets', 'textures');
const CONFIG = path.join(root, 'config.json');

const TARGET_W = 600;
const TARGET_H = 1800;

const SAMPLE_CANDIDATES = [
  path.join(tplDir, 'strip-sample-reference.png'),
  path.join(
    'C:/Users/Owner/.cursor/projects/c-docker-projects-try/assets',
    'c__Users_Owner_AppData_Roaming_Cursor_User_workspaceStorage_19bd436ec471d1d9b36a4ff338918dca_images_image-f269383a-ebc5-422d-a201-fe5bdd1e9375.png'
  ),
].filter(Boolean);

const SAMPLE_META = {
  w: 299,
  h: 725,
  slots: [
    { x: 7, y: 6, w: 282, h: 165 },
    { x: 7, y: 182, w: 282, h: 154 },
    { x: 7, y: 346, w: 282, h: 155 },
  ],
  brandY: 501,
};

function readPng(p) {
  return PNG.sync.read(fs.readFileSync(p));
}
function writePng(p, png) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, PNG.sync.write(png));
}
function clearRect(png, x, y, w, h) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(png.width, Math.ceil(x + w));
  const y1 = Math.min(png.height, Math.ceil(y + h));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (png.width * py + px) << 2;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = png.data[i + 3] = 0;
    }
  }
}
function fill(png, rgba) {
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgba[0];
    png.data[i + 1] = rgba[1];
    png.data[i + 2] = rgba[2];
    png.data[i + 3] = rgba[3];
  }
}
function fillRect(png, x, y, w, h, rgba) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      if (px < 0 || py < 0 || px >= png.width || py >= png.height) continue;
      const i = (png.width * py + px) << 2;
      png.data[i] = rgba[0];
      png.data[i + 1] = rgba[1];
      png.data[i + 2] = rgba[2];
      png.data[i + 3] = rgba[3];
    }
  }
}
function scaleNearest(src, tw, th) {
  const out = new PNG({ width: tw, height: th, colorType: 6 });
  for (let y = 0; y < th; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y / th) * src.height));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x / tw) * src.width));
      const si = (src.width * sy + sx) << 2;
      const di = (tw * y + x) << 2;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  return out;
}
function blit(dst, src, dx, dy) {
  blitClipped(dst, src, dx, dy, null);
}

/** Alpha-blit with optional axis-aligned clip rect {x,y,w,h} in destination space. */
function blitClipped(dst, src, dx, dy, clip) {
  const x0 = clip ? Math.max(0, clip.x) : 0;
  const y0 = clip ? Math.max(0, clip.y) : 0;
  const x1 = clip ? Math.min(dst.width, clip.x + clip.w) : dst.width;
  const y1 = clip ? Math.min(dst.height, clip.y + clip.h) : dst.height;
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < y0 || ty >= y1) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      if (tx < x0 || tx >= x1) continue;
      const si = (src.width * y + x) << 2;
      const di = (dst.width * ty + tx) << 2;
      const a = src.data[si + 3] / 255;
      if (a <= 0) continue;
      dst.data[di] = Math.round(src.data[si] * a + dst.data[di] * (1 - a));
      dst.data[di + 1] = Math.round(src.data[si + 1] * a + dst.data[di + 1] * (1 - a));
      dst.data[di + 2] = Math.round(src.data[si + 2] * a + dst.data[di + 2] * (1 - a));
      dst.data[di + 3] = 255;
    }
  }
}

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function hashNoise(x, y, seed) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 91.17) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * Formal anniversary field.
 * Light themes: pearl cardstock (fine fiber + soft sheen) — invitation-grade, not glitter party paper.
 */
function sampleTextureColor(x, y, base, hi, seed, width = TARGET_W, height = TARGET_H, opts = {}) {
  const light = opts.light === true;
  const nx = width > 1 ? x / (width - 1) : 0;
  const ny = height > 1 ? y / (height - 1) : 0;
  const cx = nx - 0.5;
  const cy = ny - 0.5;
  const vignette = Math.min(1, Math.sqrt(cx * cx * 1.05 + cy * cy * 0.75) * 1.15);

  if (light) {
    // Fine invitation linen (orthogonal fibers — quiet, professional)
    const fiberX = Math.sin(x * 0.48 + seed) * 0.5 + 0.5;
    const fiberY = Math.sin(y * 0.54 + seed * 1.3) * 0.5 + 0.5;
    const fiber = (fiberX * 0.55 + fiberY * 0.45 - 0.5) * 14;

    // Soft pearl sheen bands (horizontal, like pressed cardstock)
    const sheen = Math.sin(y * 0.032 + Math.sin(x * 0.014) * 0.9 + seed) * 8;

    // Low-frequency paper cloud (watercolor tooth)
    const cloud =
      (hashNoise(Math.floor(x / 16), Math.floor(y / 16), seed + 4.2) - 0.5) * 11 +
      (hashNoise(Math.floor(x / 6), Math.floor(y / 6), seed + 5.1) - 0.5) * 6;

    // Micro tooth
    const tooth = (hashNoise(x, y, seed) - 0.5) * 4.5;
    const dust = (hashNoise(x * 2.4, y * 2.4, seed + 2.2) - 0.5) * 2.4;

    // Center lift toward hi, edges toward base
    const wash = Math.sin(nx * Math.PI) * 0.45 + 0.55;
    const mix = wash * (1 - vignette * 0.35);

    let r = base[0] + (hi[0] - base[0]) * mix + fiber + sheen + cloud + tooth + dust;
    let g = base[1] + (hi[1] - base[1]) * mix + fiber * 0.92 + sheen * 0.9 + cloud + tooth + dust;
    let b = base[2] + (hi[2] - base[2]) * mix + fiber * 0.85 + sheen * 0.75 + cloud * 0.9 + tooth + dust;

    // Warm paper edge (slight ivory darkening)
    const edge = vignette * vignette * 12;
    r -= edge * 0.5;
    g -= edge * 0.42;
    b -= edge * 0.28;

    // Rare refined metallic flecks (not party glitter)
    if (hashNoise(x * 0.41, y * 0.37, seed + 9.7) > 0.994) {
      r = Math.min(255, r + 22);
      g = Math.min(255, g + 14);
      b = Math.min(255, b + 2);
    }

    return [clampByte(r), clampByte(g), clampByte(b), 255];
  }

  const grain = (hashNoise(x, y, seed) - 0.5) * 7;
  const micro = (hashNoise(x * 3.1, y * 3.1, seed + 2.4) - 0.5) * 3.5;
  const wash = Math.sin(nx * Math.PI) * 0.5 + 0.5;
  const lift = (1 - vignette) * 10 + wash * 4;
  const spark = hashNoise(x * 0.37, y * 0.41, seed + 9.7);
  const sparkOn = spark > 0.988;

  let r = base[0] + (hi[0] - base[0]) * wash * 0.22 + grain + micro + lift;
  let g = base[1] + (hi[1] - base[1]) * wash * 0.22 + grain + micro + lift;
  let b = base[2] + (hi[2] - base[2]) * wash * 0.22 + grain + micro + lift;

  const edgeDark = vignette * vignette * 18;
  r -= edgeDark;
  g -= edgeDark;
  b -= edgeDark;

  if (sparkOn) {
    const glint = 90 + hashNoise(x, y, seed + 1.2) * 90;
    r = Math.min(255, r + glint * 0.85);
    g = Math.min(255, g + glint * 0.7);
    b = Math.min(255, b + glint * 0.28);
  }

  return [clampByte(r), clampByte(g), clampByte(b), 255];
}

function fillTextured(png, base, hi, seed, opts = {}) {
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (png.width * y + x) << 2;
      const c = sampleTextureColor(x, y, base, hi, seed, png.width, png.height, opts);
      png.data[i] = c[0];
      png.data[i + 1] = c[1];
      png.data[i + 2] = c[2];
      png.data[i + 3] = c[3];
    }
  }
}

function fillTexturedRect(png, x, y, w, h, base, hi, seed, opts = {}) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(png.width, Math.ceil(x + w));
  const y1 = Math.min(png.height, Math.ceil(y + h));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (png.width * py + px) << 2;
      const c = sampleTextureColor(px, py, base, hi, seed, png.width, png.height, opts);
      png.data[i] = c[0];
      png.data[i + 1] = c[1];
      png.data[i + 2] = c[2];
      png.data[i + 3] = c[3];
    }
  }
}

function setPixel(png, x, y, rgba, alpha = 1) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (png.width * y + x) << 2;
  const a = Math.max(0, Math.min(1, alpha));
  png.data[i] = clampByte(png.data[i] * (1 - a) + rgba[0] * a);
  png.data[i + 1] = clampByte(png.data[i + 1] * (1 - a) + rgba[1] * a);
  png.data[i + 2] = clampByte(png.data[i + 2] * (1 - a) + rgba[2] * a);
}

function drawLine(png, x0, y0, x1, y1, rgba, alpha = 0.55) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = Math.round(x0);
  let y = Math.round(y0);
  const xEnd = Math.round(x1);
  const yEnd = Math.round(y1);
  for (;;) {
    setPixel(png, x, y, rgba, alpha);
    if (x === xEnd && y === yEnd) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Quiet Art Deco corner ticks — formal, not a full outer border. */
function drawFormalAccents(png, theme, pad = 22) {
  const gold = theme.rim;
  const goldHi = theme.rimHi;
  const w = png.width;
  const h = png.height;
  const left = pad;
  const right = w - pad - 1;
  const top = pad;
  const bottom = h - pad - 1;

  // Corner brackets only (no continuous side rail)
  const arm = Math.max(22, Math.round(Math.min(w, h) * 0.038));
  const corners = [
    [left, top, 1, 1],
    [right, top, -1, 1],
    [left, bottom, 1, -1],
    [right, bottom, -1, -1],
  ];
  for (const [cx, cy, sx, sy] of corners) {
    drawLine(png, cx, cy, cx + arm * sx, cy, goldHi, 0.55);
    drawLine(png, cx, cy, cx, cy + arm * sy, goldHi, 0.55);
    drawLine(png, cx + sx, cy + sy, cx + (arm - 5) * sx, cy + sy, gold, 0.28);
    drawLine(png, cx + sx, cy + sy, cx + sx, cy + (arm - 5) * sy, gold, 0.28);
  }
}

const ANNIV_THEMES = {
  gold: {
    // Champagne gold field + navy accents (navy/gold combination, not monochrome gold)
    fieldTexture: 'gold-field.png',
    fieldTexture4x6: 'gold-field-4x6.png',
    confettiTexture: 'gold-confetti.png',
    underfill: [210, 158, 52],
    underfillHi: [236, 198, 98],
    footer: [188, 138, 42],
    footerHi: [224, 180, 78],
    rim: [212, 175, 55],
    rimHi: [248, 220, 140],
    rimDeep: [118, 82, 22],
    rimTip: [255, 240, 190],
    // Companion navy for footer / side rails
    accentNavy: [6, 14, 42],
    accentNavyHi: [24, 42, 92],
    accentIvory: [245, 236, 210],
    seed: 11,
    confettiAlpha: 0.68,
    slotBorderPx: 5,
    outerBorderPx: 7,
    sparkWarm: true,
    underfillHex: '#d29e34',
    comboAccents: true,
  },
  blue: {
    // Navy glitter field + gold confetti; gold gradient frames
    fieldTexture: 'navy-field.png',
    fieldTexture4x6: 'navy-field-4x6.png',
    confettiTexture: 'gold-confetti.png',
    underfill: [5, 10, 40],
    underfillHi: [20, 35, 80],
    footer: [4, 8, 32],
    footerHi: [16, 28, 70],
    rimDeep: [118, 82, 22],
    rim: [212, 175, 55],
    rimHi: [248, 220, 140],
    rimTip: [255, 240, 190],
    seed: 29,
    confettiAlpha: 0.72,
    slotBorderPx: 5,
    outerBorderPx: 7,
    sparkWarm: false,
    underfillHex: '#050b28',
  },
};

function texturePath(name) {
  return path.join(texDir, name);
}

/** Cover destination with a photo texture (scale to cover, center-crop). */
function fillWithPhotoTexture(dst, srcPath) {
  if (!fs.existsSync(srcPath)) {
    fill(dst, [30, 30, 30, 255]);
    return;
  }
  const src = readPng(srcPath);
  const scale = Math.max(dst.width / src.width, dst.height / src.height);
  const tw = Math.max(1, Math.round(src.width * scale));
  const th = Math.max(1, Math.round(src.height * scale));
  const scaled = scaleNearest(src, tw, th);
  const ox = Math.floor((tw - dst.width) / 2);
  const oy = Math.floor((th - dst.height) / 2);
  for (let y = 0; y < dst.height; y++) {
    for (let x = 0; x < dst.width; x++) {
      const si = (tw * (y + oy) + (x + ox)) << 2;
      const di = (dst.width * y + x) << 2;
      dst.data[di] = scaled.data[si];
      dst.data[di + 1] = scaled.data[si + 1];
      dst.data[di + 2] = scaled.data[si + 2];
      dst.data[di + 3] = 255;
    }
  }
}

/** Soften / enrich field: slight vignette so logos read cleanly.
 *  Gold theme also warms olive/mustard pixels toward champagne honey. */
function applyFieldFinish(dst, theme) {
  const w = dst.width;
  const h = dst.height;
  const warmGold = theme?.sparkWarm === true;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = x / (w - 1) - 0.5;
      const ny = y / (h - 1) - 0.5;
      const v = Math.min(1, Math.sqrt(nx * nx * 1.2 + ny * ny * 0.9) * 1.25);
      const dark = v * v * 18;
      const i = (w * y + x) << 2;
      let r = dst.data[i];
      let g = dst.data[i + 1];
      let b = dst.data[i + 2];
      if (warmGold) {
        // Lift toward honey gold; pull greenish cast out of muddy field pixels
        r = Math.min(255, r + 8);
        g = Math.min(255, Math.round(g * 0.97 + 4));
        b = Math.max(0, Math.round(b * 0.88));
      }
      dst.data[i] = clampByte(r - dark);
      dst.data[i + 1] = clampByte(g - dark);
      dst.data[i + 2] = clampByte(b - dark * 1.05);
    }
  }
}

/** How far confetti may spill into photo holes (px). */
function confettiMaxIntrusion(dst) {
  return Math.max(72, Math.round(Math.min(dst.width, dst.height) * 0.12));
}

/**
 * Overlay metallic confetti ribbons (black keyed out).
 * Allows ribbons to spill into photo holes with alpha so they overlap frames realistically.
 */
function overlayConfetti(dst, confettiPath, alpha = 0.5, slots = null) {
  if (!fs.existsSync(confettiPath)) return;
  const src = readPng(confettiPath);
  const scale = Math.max(dst.width / src.width, dst.height / src.height) * 1.08;
  const tw = Math.max(1, Math.round(src.width * scale));
  const th = Math.max(1, Math.round(src.height * scale));
  const scaled = scaleNearest(src, tw, th);
  const ox = Math.floor((tw - dst.width) / 2);
  const oy = Math.floor((th - dst.height) / 2);
  const maxIntrusion = confettiMaxIntrusion(dst);

  for (let y = 0; y < dst.height; y++) {
    for (let x = 0; x < dst.width; x++) {
      const di = (dst.width * y + x) << 2;
      const inHole = dst.data[di + 3] < 10;

      const si = (tw * (y + oy) + (x + ox)) << 2;
      const r = scaled.data[si];
      const g = scaled.data[si + 1];
      const b = scaled.data[si + 2];
      const lum = (r + g + b) / 3;
      // Key near-black background of confetti plate
      if (lum < 28) continue;
      // Soft edge for dark confetti shadows
      const edge = lum < 55 ? (lum - 28) / 27 : 1;
      let a = alpha * edge * (0.55 + (lum / 255) * 0.45);

      if (inHole) {
        // Only brighter metallic bits cross into frames
        if (lum < 55) continue;
        let falloff = 1;
        if (slots?.length) {
          const d = distInsideSlotToEdge(x, y, slots);
          if (d == null || d > maxIntrusion) continue;
          falloff = 1 - d / maxIntrusion;
          falloff = 0.2 + falloff * 0.8;
        }
        a *= 0.95 * falloff;
        // Semi-transparent so guest photos still show underneath
        dst.data[di] = r;
        dst.data[di + 1] = g;
        dst.data[di + 2] = b;
        dst.data[di + 3] = clampByte(a * 255);
        continue;
      }

      dst.data[di] = clampByte(dst.data[di] * (1 - a) + r * a);
      dst.data[di + 1] = clampByte(dst.data[di + 1] * (1 - a) + g * a);
      dst.data[di + 2] = clampByte(dst.data[di + 2] * (1 - a) + b * a);
    }
  }
}

/** Distance from (x,y) to nearest edge while inside a slot; null if outside all slots. */
function distInsideSlotToEdge(x, y, slots) {
  let best = null;
  for (const s of slots) {
    if (x < s.x || y < s.y || x >= s.x + s.w || y >= s.y + s.h) continue;
    const d = Math.min(x - s.x, s.x + s.w - 1 - x, y - s.y, s.y + s.h - 1 - y);
    if (best == null || d < best) best = d;
  }
  return best;
}

function fillThemeField(dst, theme, { finish = true } = {}) {
  const field = theme.fieldTexture ? texturePath(theme.fieldTexture) : null;
  if (field && fs.existsSync(field)) {
    fillWithPhotoTexture(dst, field);
    if (finish) applyFieldFinish(dst, theme);
  } else {
    fillTextured(dst, theme.underfill, theme.underfillHi, theme.seed + 1, {
      light: !!theme.light,
    });
  }
}

function fillRectWithTheme(dst, x, y, w, h, theme, opts = {}) {
  const tmp = new PNG({ width: Math.max(1, w), height: Math.max(1, h), colorType: 6 });
  // Brand panels skip vignette so gold fills edge-to-edge without dark "margin" look
  fillThemeField(tmp, theme, { finish: opts.finish === true });
  blit(dst, tmp, x, y);
}

function applyThemeEffects(dst, theme, slots = null) {
  if (theme.confettiTexture) {
    overlayConfetti(dst, texturePath(theme.confettiTexture), theme.confettiAlpha ?? 0.5, slots);
  }
  drawAnniversarySparks(dst, theme, slots);
}

/**
 * Gold strip pairing: navy side rails + navy footer under the 20 mark,
 * with a soft gold→navy blend and thin ivory/gold hairlines.
 */
function paintGoldNavyCombo(dst, slots, footerY, footerH, theme) {
  if (!theme?.comboAccents) return;
  const navy = theme.accentNavy || [6, 14, 42];
  const navyHi = theme.accentNavyHi || [24, 42, 92];
  const ivory = theme.accentIvory || [245, 236, 210];
  const gold = theme.rim || [212, 175, 55];
  const goldHi = theme.rimHi || [248, 220, 140];
  const W = dst.width;
  const H = dst.height;
  const fy = Math.max(0, Math.round(footerY));
  const fh = Math.max(1, Math.round(footerH));
  const seed = (theme.seed || 11) + 90;

  // Soft gold→navy across the brand footer (gold logo pops on navy)
  const blend = Math.max(28, Math.round(fh * 0.18));
  for (let y = fy; y < Math.min(H, fy + fh); y++) {
    const raw = Math.min(1, Math.max(0, (y - fy) / blend));
    const a = raw * raw * (3 - 2 * raw); // smoothstep
    for (let x = 0; x < W; x++) {
      const i = (W * y + x) << 2;
      if (dst.data[i + 3] < 10) continue;
      const n = sampleTextureColor(x, y, navy, navyHi, seed, W, H, {});
      dst.data[i] = clampByte(dst.data[i] * (1 - a) + n[0] * a);
      dst.data[i + 1] = clampByte(dst.data[i + 1] * (1 - a) + n[1] * a);
      dst.data[i + 2] = clampByte(dst.data[i + 2] * (1 - a) + n[2] * a);
    }
  }

  // Navy side rails along the photo column (gold field stays in the center)
  const rail = Math.max(14, Math.round(W * 0.045));
  const photoBottom = fy;
  fillTexturedRect(dst, 0, 0, rail, photoBottom, navy, navyHi, seed + 1);
  fillTexturedRect(dst, W - rail, 0, rail, photoBottom, navy, navyHi, seed + 2);

  // Gold hairline where navy rail meets the gold field
  for (let y = 0; y < photoBottom; y++) {
    setPixelOpaque(dst, rail, y, goldHi);
    setPixelOpaque(dst, rail + 1, y, gold);
    setPixelOpaque(dst, W - rail - 1, y, gold);
    setPixelOpaque(dst, W - rail - 2, y, goldHi);
  }

  // Thin ivory + gold rule above the navy footer
  const ruleY = Math.max(0, fy - 3);
  for (let x = rail; x < W - rail; x++) {
    setPixelOpaque(dst, x, ruleY, ivory);
    setPixelOpaque(dst, x, ruleY + 1, goldHi);
    setPixelOpaque(dst, x, ruleY + 2, gold);
  }

  // Soft navy tint in gutters between slots
  if (slots?.length > 1) {
    for (let i = 0; i < slots.length - 1; i++) {
      const aSlot = slots[i];
      const bSlot = slots[i + 1];
      const gy0 = aSlot.y + aSlot.h;
      const gy1 = bSlot.y;
      if (gy1 <= gy0) continue;
      for (let y = gy0; y < gy1; y++) {
        for (let x = rail + 2; x < W - rail - 2; x++) {
          const di = (W * y + x) << 2;
          if (dst.data[di + 3] < 10) continue;
          const t = 0.28;
          dst.data[di] = clampByte(dst.data[di] * (1 - t) + navy[0] * t);
          dst.data[di + 1] = clampByte(dst.data[di + 1] * (1 - t) + navy[1] * t);
          dst.data[di + 2] = clampByte(dst.data[di + 2] * (1 - t) + navy[2] * t);
        }
      }
    }
  }
}

function blendPixel(png, x, y, rgba, alpha) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (png.width * y + x) << 2;
  const a = Math.max(0, Math.min(1, alpha));
  if (a <= 0) return;
  // Preserve holes as translucent sparkle so photos still show
  if (png.data[i + 3] < 10) {
    const existingA = png.data[i + 3] / 255;
    const outA = existingA + a * (1 - existingA);
    if (outA <= 0.001) return;
    png.data[i] = clampByte((png.data[i] * existingA * (1 - a) + rgba[0] * a) / outA);
    png.data[i + 1] = clampByte((png.data[i + 1] * existingA * (1 - a) + rgba[1] * a) / outA);
    png.data[i + 2] = clampByte((png.data[i + 2] * existingA * (1 - a) + rgba[2] * a) / outA);
    png.data[i + 3] = clampByte(outA * 255);
    return;
  }
  png.data[i] = clampByte(png.data[i] * (1 - a) + rgba[0] * a);
  png.data[i + 1] = clampByte(png.data[i + 1] * (1 - a) + rgba[1] * a);
  png.data[i + 2] = clampByte(png.data[i + 2] * (1 - a) + rgba[2] * a);
}

function drawSoftGlow(png, cx, cy, radius, rgba, strength = 0.55) {
  const r0 = Math.max(1, Math.round(radius));
  for (let dy = -r0; dy <= r0; dy++) {
    for (let dx = -r0; dx <= r0; dx++) {
      const d = Math.hypot(dx, dy) / r0;
      if (d > 1) continue;
      const a = strength * (1 - d) * (1 - d);
      blendPixel(png, cx + dx, cy + dy, rgba, a);
    }
  }
}

/** 4-point spark / lens-flare tick — white celebration glint. */
function drawSparkBurst(png, cx, cy, arm, rgba, strength = 0.85) {
  const len = Math.max(2, Math.round(arm));
  for (let t = -len; t <= len; t++) {
    const fall = 1 - Math.abs(t) / len;
    const a = strength * fall * fall;
    blendPixel(png, cx + t, cy, rgba, a);
    blendPixel(png, cx, cy + t, rgba, a * 0.95);
    if (Math.abs(t) <= len * 0.55) {
      blendPixel(png, cx + t, cy + t, rgba, a * 0.35);
      blendPixel(png, cx + t, cy - t, rgba, a * 0.35);
    }
  }
  // Hot core
  blendPixel(png, cx, cy, [255, 255, 255], strength);
  blendPixel(png, cx + 1, cy, rgba, strength * 0.55);
  blendPixel(png, cx, cy + 1, rgba, strength * 0.55);
}

function pointInAnySlot(x, y, slots) {
  if (!slots?.length) return false;
  return slots.some((s) => x >= s.x && y >= s.y && x < s.x + s.w && y < s.y + s.h);
}

/**
 * White / champagne sparks appropriate to anniversary gala theme.
 * Gold strips get warm white; navy strips get cool ice-white.
 */
function drawAnniversarySparks(dst, theme, slots = null) {
  const w = dst.width;
  const h = dst.height;
  const seed = theme.seed || 11;
  const warm = theme.sparkWarm !== false;
  const white = [255, 255, 255];
  const accent = warm ? [255, 248, 220] : [230, 240, 255];
  const soft = warm ? [255, 236, 190] : [190, 215, 255];

  const okOnField = (x, y, maxInSlot = 14) => {
    if (!pointInAnySlot(x, y, slots)) return true;
    const d = distInsideSlotToEdge(x, y, slots);
    return d != null && d <= maxInSlot;
  };

  // Tiny dust sparkles across the field (skip deep slot centers)
  const dustCount = Math.round((w * h) / 1400);
  for (let i = 0; i < dustCount; i++) {
    const x = Math.floor(hashNoise(i * 3.1, seed, seed + 1.2) * w);
    const y = Math.floor(hashNoise(i * 7.7, seed + 2.4, seed + 3.1) * h);
    if (!okOnField(x, y, 16)) continue;
    const bright = hashNoise(x, y, seed + 8.8);
    const a = 0.4 + bright * 0.55;
    const col = bright > 0.55 ? white : accent;
    blendPixel(dst, x, y, col, a);
    if (bright > 0.78) {
      blendPixel(dst, x + 1, y, white, a * 0.55);
      blendPixel(dst, x, y + 1, white, a * 0.55);
      blendPixel(dst, x - 1, y, white, a * 0.35);
      blendPixel(dst, x, y - 1, white, a * 0.35);
    }
  }

  // Larger star bursts — gutters, margins, and footer (celebration glints)
  const burstCount = Math.max(22, Math.round((w * h) / 42000));
  for (let i = 0; i < burstCount; i++) {
    const x = Math.floor(8 + hashNoise(i * 11.3, seed + 4, 1.7) * (w - 16));
    const y = Math.floor(8 + hashNoise(i * 5.9, seed + 6, 2.2) * (h - 16));
    if (!okOnField(x, y, 20)) continue;
    const size = 4 + Math.floor(hashNoise(i, seed + 9, 3.3) * 9);
    const strength = 0.65 + hashNoise(i, seed + 10, 4.1) * 0.35;
    drawSoftGlow(dst, x, y, size * 1.8, soft, strength * 0.28);
    drawSparkBurst(dst, x, y, size, white, strength);
    if (hashNoise(i, seed + 12, 5.5) > 0.4) {
      drawSparkBurst(dst, x, y, Math.max(2, Math.round(size * 0.6)), accent, strength * 0.7);
    }
  }

  // Soft bokeh orbs (gala light scatter)
  const orbCount = Math.max(8, Math.round((w * h) / 110000));
  for (let i = 0; i < orbCount; i++) {
    const x = Math.floor(16 + hashNoise(i * 2.2, seed + 14, 6.1) * (w - 32));
    const y = Math.floor(16 + hashNoise(i * 4.4, seed + 15, 7.2) * (h - 32));
    if (!okOnField(x, y, 10)) continue;
    const radius = 7 + Math.floor(hashNoise(i, seed + 16, 8.3) * 16);
    drawSoftGlow(dst, x, y, radius, soft, 0.16 + hashNoise(i, seed + 17, 9.1) * 0.18);
    drawSoftGlow(dst, x, y, Math.max(2, Math.round(radius * 0.32)), white, 0.28);
  }

  // Short diagonal glints along side margins (extra celebration flash)
  const streakCount = Math.max(6, Math.round(h / 220));
  for (let i = 0; i < streakCount; i++) {
    const left = hashNoise(i, seed + 20, 1.1) > 0.5;
    const x = left
      ? Math.floor(4 + hashNoise(i, seed + 21, 2.2) * 18)
      : Math.floor(w - 22 + hashNoise(i, seed + 22, 3.3) * 14);
    const y = Math.floor(24 + hashNoise(i * 3.3, seed + 23, 4.4) * (h - 48));
    if (!okOnField(x, y, 8)) continue;
    const len = 5 + Math.floor(hashNoise(i, seed + 24, 5.5) * 8);
    const a0 = 0.55 + hashNoise(i, seed + 25, 6.6) * 0.35;
    for (let t = 0; t < len; t++) {
      const fall = 1 - t / len;
      const dx = left ? t : -t;
      blendPixel(dst, x + dx, y + t, white, a0 * fall * fall);
      blendPixel(dst, x + dx, y - t, accent, a0 * fall * 0.45);
    }
    blendPixel(dst, x, y, white, a0);
  }
}

function setPixelOpaque(png, x, y, rgba) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (png.width * y + x) << 2;
  png.data[i] = rgba[0];
  png.data[i + 1] = rgba[1];
  png.data[i + 2] = rgba[2];
  png.data[i + 3] = 255;
}

function lerpByte(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function lerpRgb(a, b, t) {
  return [lerpByte(a[0], b[0], t), lerpByte(a[1], b[1], t), lerpByte(a[2], b[2], t)];
}

/** Antique → rich → champagne gold across border thickness (0 outer → 1 inner). */
function goldGradientColor(t, theme, along = 0.5) {
  const deep = theme?.rimDeep || [118, 82, 22];
  const mid = theme?.rim || [212, 175, 55];
  const hi = theme?.rimHi || [248, 220, 140];
  const tip = theme?.rimTip || [255, 240, 190];
  const u = Math.max(0, Math.min(1, t));
  let base;
  if (u < 0.28) base = lerpRgb(deep, mid, u / 0.28);
  else if (u < 0.72) base = lerpRgb(mid, hi, (u - 0.28) / 0.44);
  else base = lerpRgb(hi, tip, (u - 0.72) / 0.28);
  // Soft highlight travel along the edge for a metallic sheen
  const sheen = 0.08 + 0.12 * Math.sin(along * Math.PI * 2);
  return [
    Math.min(255, Math.round(base[0] + (tip[0] - base[0]) * sheen)),
    Math.min(255, Math.round(base[1] + (tip[1] - base[1]) * sheen)),
    Math.min(255, Math.round(base[2] + (tip[2] - base[2]) * sheen)),
  ];
}

/**
 * Classic sharp gold frame around each photo hole (strips / Polaroid).
 */
function drawClassicSlotBorders(png, slots, theme) {
  const widthPx = Math.max(1, Math.min(18, Number(theme.slotBorderPx) || 5));

  for (const s of slots) {
    const x = Math.round(s.x);
    const y = Math.round(s.y);
    const w = Math.round(s.w);
    const h = Math.round(s.h);
    const peri = Math.max(1, 2 * (w + h + widthPx * 4));

    for (let t = 0; t < widthPx; t++) {
      const x0 = x - widthPx + t;
      const y0 = y - widthPx + t;
      const x1 = x + w + widthPx - 1 - t;
      const y1 = y + h + widthPx - 1 - t;
      const depth = widthPx <= 1 ? 1 : t / (widthPx - 1);

      for (let px = x0; px <= x1; px++) {
        const along = ((px - x0) / Math.max(1, x1 - x0) + (y0 + t) / peri) % 1;
        const col = goldGradientColor(depth, theme, along);
        setPixelOpaque(png, px, y0, col);
        setPixelOpaque(png, px, y1, goldGradientColor(depth, theme, (along + 0.5) % 1));
      }
      for (let py = y0; py <= y1; py++) {
        const along = ((py - y0) / Math.max(1, y1 - y0) + 0.25) % 1;
        const col = goldGradientColor(depth, theme, along);
        setPixelOpaque(png, x0, py, col);
        setPixelOpaque(png, x1, py, goldGradientColor(depth, theme, (along + 0.5) % 1));
      }
    }
  }
}

/** True if (px,py) is inside a rounded rectangle. */
function pointInRoundedRect(px, py, x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (px < x || py < y || px >= x + w || py >= y + h) return false;
  const lx = px - x;
  const ly = py - y;
  if (lx >= r && lx < w - r) return true;
  if (ly >= r && ly < h - r) return true;
  const cx = lx < r ? r : w - r;
  const cy = ly < r ? r : h - r;
  const dx = lx - cx;
  const dy = ly - cy;
  return dx * dx + dy * dy <= r * r;
}

/** Signed distance outside a rounded rect (0 on edge, >0 outside, <0 inside). */
function sdRoundedBox(px, py, x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  const cx = x + w / 2;
  const cy = y + h / 2;
  const hx = w / 2 - r;
  const hy = h / 2 - r;
  const qx = Math.abs(px - cx) - hx;
  const qy = Math.abs(py - cy) - hy;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * Flawless soft-corner gold frames: crisp inner lip flush to the rectangular
 * photo hole, rounded outer edge with anti-aliased falloff (gutters only).
 */
function drawSoftSlotBorders(png, slots, theme) {
  const widthPx = Math.max(4, Math.min(22, Number(theme.slotBorderPx) || 12));
  const radius = Math.max(
    10,
    Math.min(28, Number(theme.slotFrameRadius) || Math.round(widthPx * 1.25))
  );

  for (const s of slots) {
    const x = Math.round(s.x);
    const y = Math.round(s.y);
    const w = Math.round(s.w);
    const h = Math.round(s.h);
    if (w < 8 || h < 8) continue;

    const ox = x - widthPx;
    const oy = y - widthPx;
    const ow = w + widthPx * 2;
    const oh = h + widthPx * 2;
    const rOuter = Math.min(radius + widthPx * 0.35, ow / 2, oh / 2);
    const peri = Math.max(1, 2 * (ow + oh));

    const x0 = Math.max(0, Math.floor(ox - 1));
    const y0 = Math.max(0, Math.floor(oy - 1));
    const x1 = Math.min(png.width - 1, Math.ceil(ox + ow + 1));
    const y1 = Math.min(png.height - 1, Math.ceil(oy + oh + 1));

    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const cx = px + 0.5;
        const cy = py + 0.5;
        // Sharp rectangular hole — photo fills flush with no corner gaps
        if (cx >= x && cx < x + w && cy >= y && cy < y + h) continue;

        const dOut = sdRoundedBox(cx, cy, ox, oy, ow, oh, rOuter);
        if (dOut > 1.25) continue;

        // Distance from photo hole (how far into the mat / border)
        const dLeft = x - cx;
        const dRight = cx - (x + w);
        const dTop = y - cy;
        const dBottom = cy - (y + h);
        const distFromHole = Math.max(dLeft, dRight, dTop, dBottom);
        if (distFromHole > widthPx + 1.25) continue;

        const depth = Math.max(0, Math.min(1, distFromHole / Math.max(1, widthPx)));
        // Bright inner lip against the photo, deeper antique toward outer edge
        const lip = Math.max(0, 1 - distFromHole / 2.2);
        const along = ((cx - ox) / Math.max(1, ow) + (cy - oy) / peri) % 1;
        const col = goldGradientColor(Math.min(1, depth * 0.72 + lip * 0.45), theme, along);
        const tip = theme.rimTip || [255, 240, 190];
        const rgb = [
          Math.min(255, Math.round(col[0] + (tip[0] - col[0]) * lip * 0.55)),
          Math.min(255, Math.round(col[1] + (tip[1] - col[1]) * lip * 0.55)),
          Math.min(255, Math.round(col[2] + (tip[2] - col[2]) * lip * 0.5)),
        ];

        let alpha = 1;
        if (dOut > 0) alpha = Math.max(0, 1 - dOut);
        if (distFromHole > widthPx) alpha = Math.min(alpha, Math.max(0, 1 - (distFromHole - widthPx)));
        if (alpha >= 0.995) setPixelOpaque(png, px, py, rgb);
        else if (alpha > 0.04) setPixel(png, px, py, rgb, alpha);
      }
    }
  }
}

function drawThinSlotBorders(png, slots, theme) {
  if (theme?.softSlotFrames) drawSoftSlotBorders(png, slots, theme);
  else drawClassicSlotBorders(png, slots, theme);
}

function classicFrameTheme(theme) {
  return {
    ...theme,
    softSlotFrames: false,
    slotBorderPx: 5,
    outerBorderPx: 7,
  };
}

function softFrameTheme(theme) {
  return {
    ...theme,
    softSlotFrames: true,
    slotBorderPx: 12,
    outerBorderPx: 14,
    slotFrameRadius: 16,
  };
}

/** Outer sheet/strip gold border with the same metallic gradient. */
function drawOuterGoldBorder(png, theme, widthOverride = null) {
  const widthPx = Math.max(
    2,
    Math.min(32, Number(widthOverride ?? theme?.outerBorderPx) || 16)
  );
  const W = png.width;
  const H = png.height;
  const peri = Math.max(1, 2 * (W + H));

  for (let t = 0; t < widthPx; t++) {
    const x0 = t;
    const y0 = t;
    const x1 = W - 1 - t;
    const y1 = H - 1 - t;
    // Outer edge darker, inner edge brighter (inward toward content)
    const depth = widthPx <= 1 ? 1 : t / (widthPx - 1);

    for (let px = x0; px <= x1; px++) {
      const along = px / Math.max(1, W - 1);
      setPixelOpaque(png, px, y0, goldGradientColor(depth, theme, along));
      setPixelOpaque(png, px, y1, goldGradientColor(depth, theme, (along + 0.35) % 1));
    }
    for (let py = y0; py <= y1; py++) {
      const along = py / Math.max(1, H - 1);
      setPixelOpaque(png, x0, py, goldGradientColor(depth, theme, along));
      setPixelOpaque(png, x1, py, goldGradientColor(depth, theme, (along + 0.35) % 1));
    }
  }
}

function keyOutNearBlack(png, threshold = 18) {
  for (let i = 0; i < png.data.length; i += 4) {
    const v = (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3;
    if (v < threshold) png.data[i + 3] = 0;
  }
}

/** Trim empty/transparent margins so logos fill their target box. */
function cropOpaqueBounds(png, alphaMin = 10, pad = 4) {
  let minX = png.width;
  let minY = png.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (png.data[((png.width * y + x) << 2) + 3] < alphaMin) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return png;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(png.width - 1, maxX + pad);
  maxY = Math.min(png.height - 1, maxY + pad);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  if (w >= png.width - 2 && h >= png.height - 2) return png;
  const out = new PNG({ width: w, height: h, colorType: 6 });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((png.width * (minY + y) + (minX + x)) << 2);
      const di = ((w * y + x) << 2);
      out.data[di] = png.data[si];
      out.data[di + 1] = png.data[si + 1];
      out.data[di + 2] = png.data[si + 2];
      out.data[di + 3] = png.data[si + 3];
    }
  }
  return out;
}

/** Punch black canvas around a circular seal; keep the colored disc. */
function prepareAgencySeal(src) {
  const out = new PNG({ width: src.width, height: src.height, colorType: 6 });
  out.data.set(src.data);
  keyOutNearBlack(out, 14);

  // Soft circular matte so the seal reads as a badge, not a black square
  const cx = (out.width - 1) / 2;
  const cy = (out.height - 1) / 2;
  const radius = Math.min(cx, cy) * 0.98;
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const i = (out.width * y + x) << 2;
      if (out.data[i + 3] === 0) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius) {
        out.data[i + 3] = 0;
      } else if (d > radius - 2) {
        out.data[i + 3] = Math.round(out.data[i + 3] * ((radius - d) / 2));
      }
    }
  }
  return out;
}

function drawGoldDivider(dst, y, panelX, boxW, theme) {
  const mid = panelX + Math.round(boxW / 2);
  const half = Math.round(boxW * 0.18);
  const gold = theme?.rim || [168, 132, 40];
  const goldHi = theme?.rimHi || [196, 158, 48];
  drawLine(dst, mid - half, y, mid + half, y, gold, 0.45);
  drawLine(dst, mid - half, y + 1, mid + half, y + 1, goldHi, 0.22);
  // Tiny diamond center mark (excellence cue)
  for (let dy = -2; dy <= 2; dy++) {
    const span = 2 - Math.abs(dy);
    for (let dx = -span; dx <= span; dx++) {
      setPixel(dst, mid + dx, y + dy, goldHi, 0.55);
    }
  }
}

/** Soft-fade the outer edge of a logo so it doesn't read as a hard gold card. */
function featherPngEdges(png, featherPx = 18) {
  const f = Math.max(1, Math.round(featherPx));
  const w = png.width;
  const h = png.height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (w * y + x) << 2;
      if (png.data[i + 3] < 8) continue;
      const d = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (d >= f) continue;
      const m = d / f;
      png.data[i + 3] = Math.round(png.data[i + 3] * m * m);
    }
  }
}

/**
 * Footer stack centered mid-panel:
 * default: large 20 Years mark → divider → small agency seal
 * sealAbove: agency seal → 20 Years mark
 * @param {{ annivRatio?: number, sealRatio?: number, padYRatio?: number, sealOverlay?: boolean, sealAbove?: boolean, logoScale?: number }} [opts]
 */
function blitAnniversaryLogo(dst, footerY, footerH, canvasW = TARGET_W, panelX = 0, panelW = null, theme = null, opts = {}) {
  const annivPath = path.join(tplDir, 'logo.png');
  const agencyPath = [
    path.join(tplDir, 'gz5-logo.png'),
    path.join(tplDir, 'gz5 logo.png'),
  ].find((p) => fs.existsSync(p));

  const boxW = panelW == null ? canvasW : panelW;
  const minPad = opts.minPad ?? 4;
  const padX = Math.max(minPad, Math.round(boxW * (opts.padXRatio ?? 0.06)));
  const padY = Math.max(minPad, Math.round(footerH * (opts.padYRatio ?? 0.05)));
  const gap = Math.max(6, Math.round(footerH * 0.02));
  const usableH = Math.max(40, footerH - padY * 2);
  const usableW = Math.max(40, boxW - padX * 2);

  const hasSeal = !!agencyPath && opts.noSeal !== true;
  const hasAnniv = fs.existsSync(annivPath);
  const defaultAnniv = hasSeal ? 0.78 : 0.9;
  const annivRatio = opts.annivRatio ?? defaultAnniv;
  const sealRatio = opts.sealRatio ?? 0.11;
  const sealOverlay = opts.sealOverlay === true;
  const sealAbove = opts.sealAbove === true && !sealOverlay;

  let annivScaled = null;
  let sealScaled = null;
  let stackH = 0;

  if (hasSeal) {
    const seal = prepareAgencySeal(readPng(agencyPath));
    const maxH = Math.round(usableH * sealRatio);
    const maxW = Math.min(Math.round(boxW * 0.14), usableW);
    const scale = Math.min(maxW / seal.width, maxH / seal.height);
    const sw = Math.max(1, Math.round(seal.width * scale));
    const sh = Math.max(1, Math.round(seal.height * scale));
    sealScaled = prepareAgencySeal(scaleNearest(seal, sw, sh));
  }

  const divBudget = opts.noDivider || sealOverlay || sealAbove ? 0 : Math.max(8, Math.round(footerH * 0.015));
  const stackGap = opts.noDivider || sealOverlay ? Math.max(4, Math.round(gap * 0.5)) : gap;

  if (hasAnniv) {
    const logoRaw = readPng(annivPath);
    keyOutNearBlack(logoRaw);
    const logo = cropOpaqueBounds(logoRaw, 40, 2);
    // Fit inside panel — never cover-crop/clip the wreath or banner
    const sealBudget =
      sealScaled && !sealOverlay ? sealScaled.height + stackGap + divBudget : 0;
    const maxH = Math.max(40, Math.round(usableH * annivRatio));
    const fitH = sealBudget ? Math.max(40, Math.min(maxH, usableH - sealBudget)) : maxH;
    let scale = Math.min(usableW / logo.width, fitH / logo.height) * (opts.logoScale ?? 1);
    // Keep final mark inside the brand panel
    const maxScaleW = usableW / logo.width;
    const maxScaleH = usableH / logo.height;
    scale = Math.min(scale, maxScaleW, maxScaleH);
    const lw = Math.max(1, Math.round(logo.width * scale));
    const lh = Math.max(1, Math.round(logo.height * scale));
    annivScaled = scaleNearest(logo, lw, lh);
    if (opts.feather !== false) {
      const f = opts.featherPx ?? Math.max(8, Math.round(Math.min(lw, lh) * 0.02));
      featherPngEdges(annivScaled, f);
    }
    stackH += lh;
  }

  if (sealScaled && !sealOverlay) {
    if (hasAnniv) stackH += stackGap + divBudget;
    stackH += sealScaled.height;
  }

  // Mid-center the whole stack in the footer/brand panel
  let cursorY = footerY + Math.round((footerH - stackH) / 2);
  cursorY = Math.max(footerY + padY, Math.min(cursorY, footerY + footerH - stackH - padY));

  const blitSealAt = (sealY) => {
    const dx = panelX + Math.round((boxW - sealScaled.width) / 2);
    const sw = sealScaled.width;
    const sh = sealScaled.height;
    const cx = dx + Math.round(sw / 2);
    const cy = sealY + Math.round(sh / 2);
    const ringR = Math.round(Math.max(sw, sh) / 2) + 3;
    const gold = theme?.rim || [168, 132, 40];
    const goldHi = theme?.rimHi || [196, 158, 48];
    for (let a = 0; a < 360; a += 2) {
      const rad = (a * Math.PI) / 180;
      setPixel(dst, Math.round(cx + Math.cos(rad) * ringR), Math.round(cy + Math.sin(rad) * ringR), goldHi, 0.5);
      setPixel(dst, Math.round(cx + Math.cos(rad) * (ringR - 1)), Math.round(cy + Math.sin(rad) * (ringR - 1)), gold, 0.35);
    }
    blit(dst, sealScaled, dx, sealY);
    return sealY + sh;
  };

  if (sealScaled && sealAbove) {
    cursorY = blitSealAt(cursorY) + stackGap;
  }

  if (annivScaled) {
    const dx = panelX + Math.round((boxW - annivScaled.width) / 2);
    blit(dst, annivScaled, dx, cursorY);
    cursorY += annivScaled.height;
  }

  if (annivScaled && sealScaled && !sealOverlay && !sealAbove) {
    if (divBudget > 0) {
      const divY = cursorY + Math.round(divBudget / 2);
      drawGoldDivider(dst, divY, panelX, boxW, theme);
    }
    cursorY += divBudget + stackGap;
  }

  if (sealScaled && !sealAbove) {
    const sw = sealScaled.width;
    const sh = sealScaled.height;
    const sealY = sealOverlay
      ? footerY + footerH - padY - sh
      : cursorY;
    blitSealAt(sealY);
  }
}

/** 4×6 collage landscape (6×4″): 2 photos on top, brand + 1 photo on bottom. */
function buildAnniversarySheet4x6(themeKey, slots, brandPanel, outName) {
  const base = ANNIV_THEMES[themeKey];
  if (!base) throw new Error(`Unknown theme: ${themeKey}`);
  // Landscape BGs already include ribbons/bokeh — use them as the field, skip extra confetti plate.
  const theme = softFrameTheme({
    ...base,
    fieldTexture: base.fieldTexture4x6 || base.fieldTexture,
    confettiTexture: null,
  });
  const W = 1800;
  const H = 1200;
  const out = new PNG({ width: W, height: H, colorType: 6 });
  fillThemeField(out, theme);

  for (const s of slots) {
    clearRect(out, s.x, s.y, s.w, s.h);
  }

  // Soft sparks + confetti that can spill onto photo edges (runtime toggle can hide)
  const confettiPath = base.confettiTexture ? texturePath(base.confettiTexture) : null;
  if (confettiPath) overlayConfetti(out, confettiPath, base.confettiAlpha ?? 0.55, slots);
  drawAnniversarySparks(out, theme, slots);
  // Keep hole confetti/sparks — do not clearRect after effects

  drawThinSlotBorders(out, slots, theme);
  // Logo sits on continuous sheet BG — no frame around the brand quadrant
  blitAnniversaryLogo(out, brandPanel.y, brandPanel.h, W, brandPanel.x, brandPanel.w, theme, {
    annivRatio: 0.9,
    sealRatio: 0.13,
    padXRatio: 0.05,
    padYRatio: 0.04,
    minPad: 6,
    noDivider: true,
    sealOverlay: true,
    featherPx: 5,
    logoScale: 0.98,
  });
  drawOuterGoldBorder(out, theme);
  writePng(path.join(tplDir, outName), out);
  console.log('Wrote', outName, `(${themeKey} anniversary 4x6 landscape)`);
}

/**
 * Scale source to cover target size while preserving aspect, then center-crop.
 * Avoids the stretch that non-uniform width/height scaling caused.
 */
function scaleCoverCrop(src, tw, th) {
  const scale = Math.max(tw / src.width, th / src.height);
  const sw = Math.max(1, Math.round(src.width * scale));
  const sh = Math.max(1, Math.round(src.height * scale));
  const scaled = scaleNearest(src, sw, sh);
  const ox = Math.max(0, Math.floor((sw - tw) / 2));
  const oy = Math.max(0, Math.floor((sh - th) / 2));
  return crop(scaled, ox, oy, tw, th);
}

function isPlaceholderSkyOrHill(r, g, b) {
  if (b > 180 && g > 150 && r < 200 && b >= g && g > r) return true;
  if (g > 90 && g > r + 15 && g > b + 10 && r < 160) return true;
  if (r > 200 && g > 210 && b > 220 && b >= r) return true;
  return false;
}

/** Remove cartoon landscape leftovers from strap references; keep ribbons/field. */
function scrubPlaceholderArt(png, theme) {
  let field = null;
  if (theme?.fieldTexture) {
    const fp = texturePath(theme.fieldTexture);
    if (fs.existsSync(fp)) field = scaleCoverCrop(readPng(fp), png.width, png.height);
  }
  const under = theme?.underfill || [8, 12, 36];
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (png.width * y + x) << 2;
      if (png.data[i + 3] < 10) continue;
      if (!isPlaceholderSkyOrHill(png.data[i], png.data[i + 1], png.data[i + 2])) continue;
      if (field) {
        png.data[i] = field.data[i];
        png.data[i + 1] = field.data[i + 1];
        png.data[i + 2] = field.data[i + 2];
        png.data[i + 3] = 255;
      } else {
        png.data[i] = under[0];
        png.data[i + 1] = under[1];
        png.data[i + 2] = under[2];
        png.data[i + 3] = 255;
      }
    }
  }
}

/**
 * Build a strip/sheet from reference art:
 * - aspect-correct cover crop (no stretch)
 * - placeholder landscapes scrubbed
 * - photo holes punched clean
 * - 20 Years mark from assets/logo.png (not the stretched reference logo)
 */
function buildFromReference(refName, slots, outName, width, height, borderTheme, opts = {}) {
  const refPath = path.join(tplDir, refName);
  if (!fs.existsSync(refPath)) {
    console.warn('Missing reference', refName);
    return false;
  }
  const theme = opts.theme;
  const ref = readPng(refPath);
  const scaled = scaleCoverCrop(ref, width, height);
  const out = new PNG({ width, height, colorType: 6 });
  out.data.set(scaled.data);

  if (theme) scrubPlaceholderArt(out, theme);

  for (const s of slots) {
    const pad = 3;
    clearRect(out, s.x - pad, s.y - pad, s.w + pad * 2, s.h + pad * 2);
  }

  // Light confetti/sparks on field (before brand so logo stays crisp)
  if (theme && opts.reapplyEffects !== false) {
    applyThemeEffects(out, theme, slots);
    // Keep hole confetti for optional photo overlap
  }

  const brand = opts.brandPanel;
  if (brand && theme) {
    fillRectWithTheme(out, brand.x, brand.y, brand.w, brand.h, theme);
    blitAnniversaryLogo(out, brand.y, brand.h, width, brand.x, brand.w, theme, opts.logoOpts || {
      annivRatio: 0.84,
      sealRatio: 0.11,
      padXRatio: 0.08,
      padYRatio: 0.035,
    });
  }

  if (borderTheme) drawThinSlotBorders(out, slots, borderTheme);

  writePng(path.join(tplDir, outName), out);
  console.log('Wrote', outName, `(from ${refName}, assets logo)`);
  return true;
}

/**
 * Build a 4×6 sheet from reference art (photo holes punched out).
 */
function buildAnniversarySheet4x6FromReference(refName, slots, outName, borderTheme, opts = {}) {
  return buildFromReference(refName, slots, outName, 1800, 1200, borderTheme, opts);
}

function buildAnniversaryStrip(themeKey, slots, outName) {
  const theme = classicFrameTheme(ANNIV_THEMES[themeKey]);
  if (!ANNIV_THEMES[themeKey]) throw new Error(`Unknown theme: ${themeKey}`);

  const out = new PNG({ width: TARGET_W, height: TARGET_H, colorType: 6 });
  fillThemeField(out, theme);

  const footerY = Math.max(...slots.map((s) => s.y + s.h)) + Math.round(TARGET_H * 0.012);
  const footerH = TARGET_H - footerY;

  // Gold strips: navy rails + navy footer so gold pairs with navy (not mono-gold)
  paintGoldNavyCombo(out, slots, footerY, footerH, theme);

  for (const s of slots) {
    clearRect(out, s.x, s.y, s.w, s.h);
  }

  applyThemeEffects(out, theme, slots);
  drawThinSlotBorders(out, slots, theme);
  blitAnniversaryLogo(out, footerY, footerH, TARGET_W, 0, null, theme, {
    // Match reference: large 20 mark, seal below dates (stacked, not overlaid)
    annivRatio: 0.84,
    sealRatio: 0.11,
    padXRatio: 0.08,
    padYRatio: 0.035,
  });
  drawOuterGoldBorder(out, theme);
  writePng(path.join(tplDir, outName), out);
  console.log('Wrote', outName, `(${themeKey} anniversary strip)`);
}
function crop(src, x, y, w, h) {
  const out = new PNG({ width: w, height: h, colorType: 6 });
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const sx = x + px;
      const sy = y + py;
      const si = (src.width * sy + sx) << 2;
      const di = (w * py + px) << 2;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3] ?? 255;
    }
  }
  return out;
}

function buildPrimary3() {
  const samplePath = SAMPLE_CANDIDATES.find((p) => fs.existsSync(p));
  if (!samplePath) {
    console.warn('No sample strip — keeping existing strip-blank.png if present');
    return null;
  }
  const sample = readPng(samplePath);
  fs.copyFileSync(samplePath, path.join(tplDir, 'strip-sample-reference.png'));

  const photoFrac = SAMPLE_META.brandY / SAMPLE_META.h;
  const photoBlockH = Math.round(TARGET_H * photoFrac);
  const brandBlockH = TARGET_H - photoBlockH;
  const scaleX = TARGET_W / SAMPLE_META.w;
  const scaleYPhotos = photoBlockH / SAMPLE_META.brandY;

  const slots = SAMPLE_META.slots.map((s) => ({
    x: Math.round(s.x * scaleX),
    y: Math.round(s.y * scaleYPhotos),
    w: Math.round(s.w * scaleX),
    h: Math.round(s.h * scaleYPhotos),
  }));

  const photoSrc = crop(sample, 0, 0, sample.width, SAMPLE_META.brandY);
  const brandSrc = crop(sample, 0, SAMPLE_META.brandY, sample.width, sample.height - SAMPLE_META.brandY);
  const out = new PNG({ width: TARGET_W, height: TARGET_H, colorType: 6 });
  fill(out, [235, 235, 238, 255]);
  blit(out, scaleNearest(photoSrc, TARGET_W, photoBlockH), 0, 0);
  blit(out, scaleNearest(brandSrc, TARGET_W, brandBlockH), 0, photoBlockH);
  for (const s of slots) clearRect(out, s.x, s.y, s.w, s.h);
  writePng(path.join(tplDir, 'strip-blank.png'), out);
  return slots;
}

function buildClassic(n, slots, outName, themeKey = 'gold') {
  const theme = classicFrameTheme(ANNIV_THEMES[themeKey] || ANNIV_THEMES.gold);
  const out = new PNG({ width: TARGET_W, height: TARGET_H, colorType: 6 });
  fillThemeField(out, theme);

  const footerY = Math.max(...slots.map((s) => s.y + s.h)) + 24;
  const footerH = TARGET_H - footerY;
  paintGoldNavyCombo(out, slots, footerY, footerH, theme);

  for (const s of slots) {
    clearRect(out, s.x, s.y, s.w, s.h);
  }

  applyThemeEffects(out, theme, slots);
  // Keep confetti/spark alpha in photo holes for optional overlap at compose time
  drawThinSlotBorders(out, slots, theme);
  blitAnniversaryLogo(out, footerY, footerH, TARGET_W, 0, null, theme);
  drawFormalAccents(out, theme, 12);
  drawOuterGoldBorder(out, theme);
  writePng(path.join(tplDir, outName), out);
  console.log('Wrote', outName, 'for', n, 'photos');
}

fs.mkdirSync(tplDir, { recursive: true });

/**
 * Reference-style 2×6 layout: thick textured frame (side/top margins),
 * clear gutters between photos, ~30% footer for the 20 Years mark.
 */
function buildReferenceSlots3() {
  // Tight, even gutters — photos read flush with the strip frame
  const marginX = 28;
  const marginTop = 26;
  const gutter = 14;
  const footerFrac = 0.285;
  const photoBlockH = Math.round(TARGET_H * (1 - footerFrac));
  const w = TARGET_W - marginX * 2;
  const usableH = photoBlockH - marginTop - 4;
  const slotH = Math.floor((usableH - gutter * 2) / 3);
  const slots = [];
  let y = marginTop;
  for (let i = 0; i < 3; i++) {
    const h = i === 2 ? photoBlockH - y - 4 : slotH;
    slots.push({ x: marginX, y, w, h: Math.max(120, h) });
    y += h + gutter;
  }
  return slots;
}

const slots3 = buildPrimary3();
// Slot placement only from reference layout — theme art is generated (not from ref photos)
const slotsForAnniv = buildReferenceSlots3();
console.log('Primary 3-shot slots', slotsForAnniv);
if (slots3) console.log('Also wrote strip-blank.png from sample');

const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));

function upsertTemplate(partial) {
  if (!Array.isArray(cfg.templates)) cfg.templates = [];
  const existing = cfg.templates.find((x) => x.id === partial.id);
  if (existing) {
    Object.assign(existing, partial);
    if (!('brandOverlapPx' in partial)) delete existing.brandOverlapPx;
    if (!('softSlotFrames' in partial)) delete existing.softSlotFrames;
  } else cfg.templates.push(partial);
}

// Gold + navy anniversary frames (strip color picker)
buildAnniversaryStrip('gold', slotsForAnniv, 'strip-gold-3.png');
buildAnniversaryStrip('blue', slotsForAnniv, 'strip-blue-3.png');

upsertTemplate({
  id: 'anniversary-gold',
  name: 'Gold Anniversary Strip',
  formatId: '2x6',
  photoCount: 3,
  path: 'assets/templates/strip-gold-3.png',
  overlayPath: null,
  underfillColor: ANNIV_THEMES.gold.underfillHex,
  slots: slotsForAnniv,
});
upsertTemplate({
  id: 'anniversary-navy',
  name: 'Navy Anniversary Strip',
  formatId: '2x6',
  photoCount: 3,
  path: 'assets/templates/strip-blue-3.png',
  overlayPath: null,
  underfillColor: ANNIV_THEMES.blue.underfillHex,
  slots: slotsForAnniv,
});
fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n');

const t1 = cfg.templates.find((x) => x.id === 'years-20-single');
const t2 = cfg.templates.find((x) => x.id === 'years-20-double');
const t4 = cfg.templates.find((x) => x.id === 'years-20-quad');
if (t1) buildClassic(1, t1.slots, 'strip-1.png', 'blue');
if (t2) buildClassic(2, t2.slots, 'strip-2.png', 'blue');
if (t4) buildClassic(4, t4.slots, 'strip-4.png', 'blue');

/**
 * 2×2 grid for 1800×1200 (6×4″) sheets:
 * Layout: [photo][photo] / [brand][photo]
 * Left column (brand + top-left photo) is narrower so the 20 fits and right photos get more width.
 */
function buildAligned4x6Grid(
  canvasW = 1800,
  canvasH = 1200,
  margin = 36,
  gutter = 40,
  leftFrac = 0.38
) {
  const usableW = canvasW - margin * 2;
  const usableH = canvasH - margin * 2;
  const leftW = Math.floor(usableW * leftFrac);
  const rightW = usableW - gutter - leftW;
  const cellH = Math.floor((usableH - gutter) / 2);
  const usedH = cellH * 2 + gutter;
  const oy = margin + Math.floor((usableH - usedH) / 2);
  const x0 = margin;
  const x1 = margin + leftW + gutter;
  const y0 = oy;
  const y1 = oy + cellH + gutter;
  const slots = [
    { x: x0, y: y0, w: leftW, h: cellH },
    { x: x1, y: y0, w: rightW, h: cellH },
    { x: x1, y: y1, w: rightW, h: cellH },
  ];
  const brand = { x: x0, y: y1, w: leftW, h: cellH };
  return { slots, brand, cellW: leftW, rightW, cellH, margin, gutter, leftFrac };
}

// 4×6 landscape — narrower brand column, wider right photos
const GRID_4X6 = buildAligned4x6Grid(1800, 1200, 36, 40, 0.38);
const SLOTS_4X6_3 = GRID_4X6.slots;
const BRAND_4X6 = GRID_4X6.brand;
console.log('4×6 aligned grid', {
  margin: GRID_4X6.margin,
  gutter: GRID_4X6.gutter,
  leftFrac: GRID_4X6.leftFrac,
  left: `${GRID_4X6.cellW}×${GRID_4X6.cellH}`,
  right: `${GRID_4X6.rightW}×${GRID_4X6.cellH}`,
  slots: SLOTS_4X6_3,
  brand: BRAND_4X6,
});

buildAnniversarySheet4x6('gold', SLOTS_4X6_3, BRAND_4X6, 'sheet-gold-4x6-3.png');
buildAnniversarySheet4x6('blue', SLOTS_4X6_3, BRAND_4X6, 'sheet-blue-4x6-3.png');

upsertTemplate({
  id: 'anniversary-gold-4x6',
  name: 'Gold Anniversary 4x6',
  formatId: '4x6',
  photoCount: 3,
  path: 'assets/templates/sheet-gold-4x6-3.png',
  overlayPath: null,
  underfillColor: ANNIV_THEMES.gold.underfillHex,
  softSlotFrames: true,
  slots: SLOTS_4X6_3,
});
upsertTemplate({
  id: 'anniversary-navy-4x6',
  name: 'Navy Anniversary 4x6',
  formatId: '4x6',
  photoCount: 3,
  path: 'assets/templates/sheet-blue-4x6-3.png',
  overlayPath: null,
  underfillColor: ANNIV_THEMES.blue.underfillHex,
  softSlotFrames: true,
  slots: SLOTS_4X6_3,
});
fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n');

/**
 * Portrait Polaroid 4×6″ (1200×1800) — thick chin,
 * 20 mark centered and overlapping the photo/chin seam (reference).
 */
function buildPolaroidPortrait(themeKey = 'blue') {
  const theme = classicFrameTheme(ANNIV_THEMES[themeKey] || ANNIV_THEMES.blue);
  const W = 1200;
  const H = 1800;
  const side = 64;
  const top = 64;
  const chin = 420;
  const slot = {
    x: side,
    y: top,
    w: W - side * 2,
    h: H - top - chin,
  };

  const out = new PNG({ width: W, height: H, colorType: 6 });
  fillThemeField(out, theme);
  clearRect(out, slot.x, slot.y, slot.w, slot.h);

  // Gold confetti + sparks on the navy/gold body (can spill slightly into the photo hole)
  const fxTheme = {
    ...theme,
    confettiAlpha: Math.min(0.95, (theme.confettiAlpha ?? 0.72) + 0.18),
  };
  applyThemeEffects(out, fxTheme, [slot]);
  // Second confetti pass for denser gold color on the chin / margins
  if (theme.confettiTexture) {
    overlayConfetti(out, texturePath(theme.confettiTexture), 0.42, [slot]);
  }

  drawThinSlotBorders(out, [slot], theme);

  // 20 mark straddles photo bottom → chin; agency seal stacked below the 20
  const overlap = Math.round(chin * 0.52);
  const logoBox = {
    x: Math.round(W * 0.1),
    y: slot.y + slot.h - overlap,
    w: Math.round(W * 0.8),
    h: Math.round(chin * 0.62 + overlap * 0.7),
  };
  blitAnniversaryLogo(out, logoBox.y, logoBox.h, W, logoBox.x, logoBox.w, theme, {
    annivRatio: 0.82,
    sealRatio: 0.14,
    padXRatio: 0.03,
    padYRatio: 0.02,
    minPad: 4,
    noDivider: true,
    featherPx: 3,
  });

  drawOuterGoldBorder(out, theme);
  const outName = themeKey === 'gold' ? 'polaroid-gold-4x6.png' : 'polaroid-4x6.png';
  writePng(path.join(tplDir, outName), out);
  console.log('Wrote', outName, `(4×6 Polaroid ${themeKey}, overlapping logo)`);

  if (!Array.isArray(cfg.formats)) cfg.formats = [];
  cfg.formats = cfg.formats.filter((f) => f.id !== '6x4-polaroid');
  let fmt = cfg.formats.find((f) => f.id === '4x6-polaroid');
  if (!fmt) {
    cfg.formats.push({
      id: '4x6-polaroid',
      label: '4×6 Polaroid',
      physicalSizeInches: { width: 4, height: 6 },
      canvasPx: { width: 1200, height: 1800 },
      allowedPhotoCounts: [1],
    });
  } else {
    Object.assign(fmt, {
      label: '4×6 Polaroid',
      physicalSizeInches: { width: 4, height: 6 },
      canvasPx: { width: 1200, height: 1800 },
      allowedPhotoCounts: [1],
    });
  }

  cfg.templates = (cfg.templates || []).filter((t) => t.id !== 'polaroid-6x4');
  const tplId = themeKey === 'gold' ? 'polaroid-gold-4x6' : 'polaroid-4x6';
  const tplName = themeKey === 'gold' ? 'Gold Polaroid 4×6' : 'Navy Polaroid 4×6';
  upsertTemplate({
    id: tplId,
    name: tplName,
    formatId: '4x6-polaroid',
    photoCount: 1,
    path: `assets/templates/${outName}`,
    overlayPath: null,
    underfillColor: theme.underfillHex || (themeKey === 'gold' ? '#d29e34' : '#050b28'),
    brandOverlapPx: overlap,
    slots: [slot],
  });

  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n');
  return slot;
}

/**
 * Landscape 6×4″ four-photo — logo top-left, large photo top-right,
 * three equal photos along the bottom.
 */
function buildFourUp6x4(themeKey = 'blue') {
  const theme = softFrameTheme(ANNIV_THEMES[themeKey] || ANNIV_THEMES.blue);
  const W = 1800;
  const H = 1200;
  const margin = 40;
  const gutter = 40;
  const usableW = W - margin * 2;
  const usableH = H - margin * 2;

  // Top band taller (logo + hero); bottom row of 3
  const topH = Math.floor((usableH - gutter) * 0.56);
  const botH = usableH - gutter - topH;
  const logoW = Math.floor(usableW * 0.34);
  const largeW = usableW - gutter - logoW;
  const smallW = Math.floor((usableW - gutter * 2) / 3);
  const botUsed = smallW * 3 + gutter * 2;
  const botOx = margin + Math.floor((usableW - botUsed) / 2);

  const y0 = margin;
  const y1 = margin + topH + gutter;

  const brand = { x: margin, y: y0, w: logoW, h: topH };
  const slots = [
    { x: margin + logoW + gutter, y: y0, w: largeW, h: topH }, // large top-right
    { x: botOx, y: y1, w: smallW, h: botH },
    { x: botOx + smallW + gutter, y: y1, w: smallW, h: botH },
    { x: botOx + (smallW + gutter) * 2, y: y1, w: smallW, h: botH },
  ];

  const out = new PNG({ width: W, height: H, colorType: 6 });
  const fieldTheme = {
    ...theme,
    fieldTexture: theme.fieldTexture4x6 || theme.fieldTexture,
  };
  fillThemeField(out, fieldTheme);
  for (const s of slots) clearRect(out, s.x, s.y, s.w, s.h);

  applyThemeEffects(
    out,
    { ...theme, confettiAlpha: Math.min(0.88, (theme.confettiAlpha ?? 0.72) + 0.08) },
    slots
  );

  drawThinSlotBorders(out, slots, theme);

  blitAnniversaryLogo(out, brand.y, brand.h, W, brand.x, brand.w, theme, {
    annivRatio: 0.88,
    sealRatio: 0.11,
    padXRatio: 0.05,
    padYRatio: 0.04,
    minPad: 6,
    noDivider: true,
    sealOverlay: true,
    featherPx: 5,
  });

  drawOuterGoldBorder(out, theme);
  const outName = themeKey === 'gold' ? 'sheet-four-gold-6x4.png' : 'sheet-four-6x4.png';
  writePng(path.join(tplDir, outName), out);
  console.log('Wrote', outName, `(6×4 four-up ${themeKey}, logo top-left)`);

  if (!Array.isArray(cfg.formats)) cfg.formats = [];
  let fmt = cfg.formats.find((f) => f.id === '6x4-four');
  if (!fmt) {
    cfg.formats.push({
      id: '6x4-four',
      label: '6×4 Four',
      physicalSizeInches: { width: 6, height: 4 },
      canvasPx: { width: 1800, height: 1200 },
      allowedPhotoCounts: [4],
    });
  } else {
    Object.assign(fmt, {
      allowedPhotoCounts: [4],
      physicalSizeInches: { width: 6, height: 4 },
      canvasPx: { width: 1800, height: 1200 },
    });
  }

  const tplId = themeKey === 'gold' ? 'anniversary-four-gold-6x4' : 'anniversary-four-6x4';
  const tplName = themeKey === 'gold' ? 'Gold Four-Up 6×4' : 'Navy Four-Up 6×4';
  upsertTemplate({
    id: tplId,
    name: tplName,
    formatId: '6x4-four',
    photoCount: 4,
    path: `assets/templates/${outName}`,
    overlayPath: null,
    underfillColor: theme.underfillHex || (themeKey === 'gold' ? '#d29e34' : '#050b28'),
    softSlotFrames: true,
    slots,
  });

  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n');
  return { slots, brand };
}

buildPolaroidPortrait('gold');
buildPolaroidPortrait('blue');
buildFourUp6x4('gold');
buildFourUp6x4('blue');

console.log('Templates ready in', tplDir);
