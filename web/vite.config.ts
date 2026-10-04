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
  let buildId = 'development';
  let releases: (CatalogueFile & { bytes: Buffer; integrity: string })[] = [];
  const virtualId = 'virtual:funroads-release';
  return {
    name: 'funroads-data',
    configResolved(config) {
      if (config.command !== 'build') return;
      releases = publishedCatalogues(root).map((entry) => {
        const bytes = fs.readFileSync(entry.source);
        const hash = createHash('sha256').update(bytes).digest();
        return {
          ...entry, bytes, integrity: `sha256-${hash.toString('base64')}`,
          file: entry.file.replace(/\.json$/, `.${hash.toString('hex')}.json`),
        };
      });
      const inputs = [
        'vite.config.ts', 'package.json', 'package-lock.json', 'tsconfig.json',
        'countries.json', 'catalogues.mjs', 'index.html', 'service-worker.js',
        ...['src', 'public'].flatMap((directory) =>
          fs.readdirSync(path.join(import.meta.dirname, directory), { recursive: true, withFileTypes: true })
            .filter((entry) => entry.isFile())
            .map((entry) => path.relative(import.meta.dirname, path.join(entry.parentPath, entry.name)).replaceAll('\\', '/'))),
      ].sort();
      const hash = createHash('sha256');
      for (const file of inputs) hash.update(file).update('\0').update(fs.readFileSync(path.join(import.meta.dirname, file)));
      for (const { file, integrity } of releases) hash.update(file).update(integrity);
      buildId = hash.digest('hex').slice(0, 20);
    },
    resolveId(id) {
      if (id === virtualId) return `\0${virtualId}`;
    },
    load(id) {
      if (id !== `\0${virtualId}`) return;
      const catalogues = Object.fromEntries(releases.map((entry) => [
        entry.file.replace(/\.[a-f0-9]{64}\.json$/, '.json'),
        { file: entry.file, integrity: entry.integrity },
      ]));
      return `export const BUILD_ID = ${JSON.stringify(buildId)};
export const CATALOGUES = ${JSON.stringify(catalogues)};`;
    },
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
      for (const { bytes, file } of releases) {
        const destination = path.join(outDir, file);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, bytes);
      }
      const files = [
        ...Object.keys(bundle),
        'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
        ...releases.map(({ file }) => file),
      ].sort();
      const entries = files.map((file) => ({
        file,
        integrity: `sha256-${createHash('sha256').update(fs.readFileSync(path.join(outDir, file))).digest('base64')}`,
      }));
      const template = fs.readFileSync(path.join(import.meta.dirname, 'service-worker.js'), 'utf8');
      const version = createHash('sha256').update(template).update(JSON.stringify(entries)).digest('hex').slice(0, 20);
      fs.writeFileSync(path.join(outDir, 'sw.js'), template
        .replace('__BUILD_ID__', JSON.stringify(buildId))
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
