/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const cacheDir = path.join(root, 'data', 'cache');
const outDir = path.join(root, 'site');
const DATA_FILES = ['routes.json', 'linked.json'];

function funroadsData(): Plugin {
  return {
    name: 'funroads-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        const name = url.startsWith('/data/') ? url.slice(6) : '';
        if (DATA_FILES.includes(name)) {
          const file = path.join(cacheDir, name);
          if (!fs.existsSync(file)) {
            res.statusCode = 404;
            res.end('missing');
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Content-Length', String(fs.statSync(file).size));
          fs.createReadStream(file).pipe(res);
          return;
        }
        next();
      });
    },
    writeBundle(_, bundle) {
      const dataOut = path.join(outDir, 'data');
      fs.mkdirSync(dataOut, { recursive: true });
      for (const name of DATA_FILES) {
        const src = path.join(cacheDir, name);
        fs.copyFileSync(src, path.join(dataOut, name));
      }
      const files = [
        ...Object.keys(bundle),
        'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
        ...DATA_FILES.map((name) => `data/${name}`),
      ].sort();
      const entries = files.map((file) => ({
        file,
        integrity: `sha256-${createHash('sha256').update(fs.readFileSync(path.join(outDir, file))).digest('base64')}`,
      }));
      const template = fs.readFileSync(path.join(import.meta.dirname, 'service-worker.js'), 'utf8');
      const version = createHash('sha256').update(template).update(JSON.stringify(entries)).digest('hex').slice(0, 20);
      fs.writeFileSync(path.join(outDir, 'sw.js'), template
        .replace('__VERSION__', JSON.stringify(version))
        .replace('__ENTRIES__', JSON.stringify(entries)));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), funroadsData()],
  build: {
    outDir,
    // Only generated website files live here. The old dist/ stays untouched.
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
