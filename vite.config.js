import { defineConfig } from 'vite';
import { resolve, join } from 'path';
import fs from 'fs';

const root = __dirname;

/** Serve config.json + assets in dev; copy them into dist for `vite build`. */
function photoboothStatic() {
  const configPath = join(root, 'config.json');
  const assetsDir = join(root, 'assets');

  function sendFile(res, filePath, contentType) {
    if (!fs.existsSync(filePath)) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(filePath).pipe(res);
  }

  return {
    name: 'photobooth-static',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] || '';
        if (url === '/config.json') {
          sendFile(res, configPath, 'application/json; charset=utf-8');
          return;
        }
        if (url.startsWith('/assets/')) {
          const rel = url.replace(/^\/assets\//, '').replace(/\.\./g, '');
          const filePath = join(assetsDir, rel);
          if (!filePath.startsWith(assetsDir)) {
            res.statusCode = 403;
            res.end('Forbidden');
            return;
          }
          const ext = filePath.split('.').pop()?.toLowerCase();
          const type =
            ext === 'png'
              ? 'image/png'
              : ext === 'jpg' || ext === 'jpeg'
                ? 'image/jpeg'
                : ext === 'json'
                  ? 'application/json'
                  : 'application/octet-stream';
          sendFile(res, filePath, type);
          return;
        }
        next();
      });
    },
    closeBundle() {
      const outDir = resolve(root, 'dist');
      const outTpl = join(outDir, 'assets', 'templates');
      fs.mkdirSync(outTpl, { recursive: true });
      if (fs.existsSync(configPath)) {
        fs.copyFileSync(configPath, join(outDir, 'config.json'));
      }
      const srcTpl = join(assetsDir, 'templates');
      if (fs.existsSync(srcTpl)) {
        for (const name of fs.readdirSync(srcTpl)) {
          if (!/\.(png|jpg|jpeg|webp)$/i.test(name)) continue;
          fs.copyFileSync(join(srcTpl, name), join(outTpl, name));
        }
      }
    },
  };
}

export default defineConfig({
  root: 'src',
  base: './',
  publicDir: false,
  plugins: [photoboothStatic()],
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    assetsDir: 'assets',
  },
  server: {
    host: true, // localhost + 127.0.0.1 + LAN
    port: 5173,
    strictPort: true,
    open: '/', // auto-open default browser
  },
});
