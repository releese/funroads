/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { catalogueFiles, publishedCatalogues, type CatalogueFile } from './catalogues.mjs';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'site');

function funroadsData(): Plugin {
  return {
    name: 'funroads-data',
    configureServer(server) {
      const files: CatalogueFile[] = catalogueFiles(root);
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        // Existing developer links remain valid; the app uses country paths.
        const requested = /^\/data\/(routes|linked)\.json$/.test(url) ? url.replace('/data/', '/data/nl/') : url;
        const entry = files.find((item) => `/${item.file}` === requested);
        if (entry) {
          const file = entry.source;
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
      const catalogues: CatalogueFile[] = publishedCatalogues(root);
      for (const { source, file } of catalogues) {
        const destination = path.join(outDir, file);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(source, destination);
      }
      const files = [
        ...Object.keys(bundle),
        'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
        ...catalogues.map(({ file }) => file),
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
