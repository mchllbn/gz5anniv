const fs = require('fs');
const path = require('path');

const MAX_ALBUM_ITEMS = 40;

function albumPaths(userData) {
  const dir = path.join(userData, 'album');
  const imagesDir = path.join(dir, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });
  return {
    dir,
    imagesDir,
    indexPath: path.join(dir, 'index.json'),
  };
}

function readIndex(indexPath) {
  if (!fs.existsSync(indexPath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeIndex(indexPath, items) {
  fs.writeFileSync(indexPath, JSON.stringify(items, null, 2), 'utf8');
}

function makeId() {
  return `strip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function dataUrlToBuffer(dataUrl) {
  const m = String(dataUrl || '').match(/^data:[^;]+;base64,(.+)$/);
  if (m) return Buffer.from(m[1], 'base64');
  return null;
}

function listAlbum(userData) {
  const { indexPath, imagesDir } = albumPaths(userData);
  const items = readIndex(indexPath);
  return items.map((item) => {
    let thumbDataUrl = item.thumbDataUrl || null;
    if (!thumbDataUrl && item.thumbFile) {
      const thumbPath = path.join(imagesDir, item.thumbFile);
      if (fs.existsSync(thumbPath)) {
        const buf = fs.readFileSync(thumbPath);
        thumbDataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
      }
    }
    return {
      id: item.id,
      createdAt: item.createdAt,
      formatId: item.formatId,
      templateId: item.templateId,
      photoCount: item.photoCount,
      label: item.label,
      thumbDataUrl,
    };
  });
}

function getAlbumPngBase64(userData, id) {
  const { indexPath, imagesDir } = albumPaths(userData);
  const item = readIndex(indexPath).find((x) => x.id === id);
  if (!item?.imageFile) return null;
  const imagePath = path.join(imagesDir, item.imageFile);
  if (!fs.existsSync(imagePath)) return null;
  return fs.readFileSync(imagePath).toString('base64');
}

function addAlbumEntry(userData, entry) {
  if (!entry?.pngBase64) throw new Error('Nothing to save to album.');
  const { indexPath, imagesDir } = albumPaths(userData);
  const items = readIndex(indexPath);
  const id = makeId();
  const imageFile = `${id}.png`;
  const thumbFile = `${id}-thumb.jpg`;

  fs.writeFileSync(path.join(imagesDir, imageFile), Buffer.from(entry.pngBase64, 'base64'));

  const thumbBuf = dataUrlToBuffer(entry.thumbDataUrl);
  if (thumbBuf) {
    fs.writeFileSync(path.join(imagesDir, thumbFile), thumbBuf);
  }

  const record = {
    id,
    createdAt: new Date().toISOString(),
    formatId: entry.formatId || '2x6',
    templateId: entry.templateId || null,
    photoCount: entry.photoCount || 3,
    label: entry.label || null,
    imageFile,
    thumbFile,
  };
  items.unshift(record);
  while (items.length > MAX_ALBUM_ITEMS) {
    const dropped = items.pop();
    if (dropped?.imageFile) {
      try {
        fs.unlinkSync(path.join(imagesDir, dropped.imageFile));
      } catch {
        /* ignore */
      }
    }
    if (dropped?.thumbFile) {
      try {
        fs.unlinkSync(path.join(imagesDir, dropped.thumbFile));
      } catch {
        /* ignore */
      }
    }
  }
  writeIndex(indexPath, items);
  return { item: { ...record, thumbDataUrl: entry.thumbDataUrl }, count: items.length };
}

function removeAlbumEntry(userData, id) {
  const { indexPath, imagesDir } = albumPaths(userData);
  const items = readIndex(indexPath);
  const item = items.find((x) => x.id === id);
  if (item?.imageFile) {
    try {
      fs.unlinkSync(path.join(imagesDir, item.imageFile));
    } catch {
      /* ignore */
    }
  }
  if (item?.thumbFile) {
    try {
      fs.unlinkSync(path.join(imagesDir, item.thumbFile));
    } catch {
      /* ignore */
    }
  }
  const next = items.filter((x) => x.id !== id);
  writeIndex(indexPath, next);
  return next.length;
}

function clearAlbum(userData) {
  const { dir, imagesDir, indexPath } = albumPaths(userData);
  try {
    for (const f of fs.readdirSync(imagesDir)) {
      fs.unlinkSync(path.join(imagesDir, f));
    }
  } catch {
    /* ignore */
  }
  writeIndex(indexPath, []);
  return dir;
}

module.exports = {
  MAX_ALBUM_ITEMS,
  listAlbum,
  getAlbumPngBase64,
  addAlbumEntry,
  removeAlbumEntry,
  clearAlbum,
};
