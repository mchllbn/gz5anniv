import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const rel of ['output', 'logs', 'assets/templates']) {
  fs.mkdirSync(path.join(root, rel), { recursive: true });
}
