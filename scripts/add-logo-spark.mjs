/**
 * Clone the baked-in lens flare on "0" onto the top curve of "2" in logo.png.
 * Run once after replacing logo art: node scripts/add-logo-spark.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logoPath = path.join(__dirname, '..', 'assets', 'templates', 'logo.png');

/** Bright center of the flare on the "0" (auto-located on reference art). */
const SOURCE = { x: 3285, y: 969 };
/** Top outer curve of the "2" — matches missing glint in reference. */
const TARGET = { x: 2565, y: 605 };
const PATCH = 220;

function readPng(filePath) {
  return PNG.sync.read(fs.readFileSync(filePath));
}

function writePng(filePath, png) {
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

/** Screen blend: adds light like the original spark composite. */
function blitSparkScreen(dest, src, centerX, centerY) {
  const w = dest.width;
  const h = dest.height;
  const ox = Math.round(centerX - src.width / 2);
  const oy = Math.round(centerY - src.height / 2);

  for (let sy = 0; sy < src.height; sy++) {
    for (let sx = 0; sx < src.width; sx++) {
      const tx = ox + sx;
      const ty = oy + sy;
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;

      const si = (sy * src.width + sx) * 4;
      const sa = src.data[si + 3] / 255;
      if (sa < 0.03) continue;

      const ti = (ty * w + tx) * 4;
      for (let c = 0; c < 3; c++) {
        const s = (src.data[si + c] / 255) * sa;
        const d = dest.data[ti + c] / 255;
        const out = 1 - (1 - d) * (1 - s);
        dest.data[ti + c] = Math.min(255, Math.round(out * 255));
      }
    }
  }
}

function extractPatch(png, cx, cy, size) {
  const half = Math.floor(size / 2);
  const out = new PNG({ width: size, height: size });
  for (let sy = 0; sy < size; sy++) {
    for (let sx = 0; sx < size; sx++) {
      const x = cx - half + sx;
      const y = cy - half + sy;
      const oi = (sy * size + sx) * 4;
      if (x < 0 || y < 0 || x >= png.width || y >= png.height) {
        out.data[oi + 3] = 0;
        continue;
      }
      const pi = (y * png.width + x) * 4;
      out.data[oi] = png.data[pi];
      out.data[oi + 1] = png.data[pi + 1];
      out.data[oi + 2] = png.data[pi + 2];
      out.data[oi + 3] = png.data[pi + 3];
    }
  }
  return out;
}

if (!fs.existsSync(logoPath)) {
  console.error('Missing', logoPath);
  process.exit(1);
}

console.log('Reading', logoPath);
const logo = readPng(logoPath);
const sparkPatch = extractPatch(logo, SOURCE.x, SOURCE.y, PATCH);
blitSparkScreen(logo, sparkPatch, TARGET.x, TARGET.y);
writePng(logoPath, logo);
console.log('Added spark on "2" at', TARGET, 'from flare at', SOURCE);
