import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const legacyAssets = new Set(['dirano', 'eyebolt', 'gorocca', 'fenice', 'barugerukan', 'obelisk', 'bloom-tan', 'sumoeru', 'dread-arrow', 'mocchario', 'chrome-gear', 'rubidevi', 'astauros', 'paladier', 'nyan-tank', 'yomigama', 'cool-kai']);

function repositoryAssetMiddleware() {
  return async (request: { url?: string }, response: { statusCode: number; setHeader(name: string, value: string): void; end(body?: Uint8Array): void }, next: () => void) => {
    const match = /^\/characters\/(runtime|master)\/([a-z0-9-]+)\.(webp|png)$/u.exec(request.url ?? '');
    if (!match || !legacyAssets.has(match[2])) return next();
    const [, directory, asset, extension] = match;
    if ((directory === 'runtime' && extension !== 'webp') || (directory === 'master' && extension !== 'png')) return next();
    try {
      const bytes = await readFile(resolve(repositoryRoot, 'assets', 'characters', directory, `${asset}.${extension}`));
      response.setHeader('Content-Type', extension === 'webp' ? 'image/webp' : 'image/png');
      response.end(bytes);
    } catch {
      response.statusCode = 404;
      response.end();
    }
  };
}

const localRepositoryAssets = {
  name: 'content-studio-local-repository-assets',
  configureServer(server: { middlewares: { use(route: string, handler: ReturnType<typeof repositoryAssetMiddleware>): void } }) {
    server.middlewares.use('/assets', repositoryAssetMiddleware());
  },
  configurePreviewServer(server: { middlewares: { use(route: string, handler: ReturnType<typeof repositoryAssetMiddleware>): void } }) {
    server.middlewares.use('/assets', repositoryAssetMiddleware());
  },
};

export default defineConfig({
  base: './',
  plugins: [react(), localRepositoryAssets],
  build: {
    target: 'es2022',
    // Production Pages assets should not expose the complete TypeScript source
    // tree or make the offline cache carry multi-megabyte source maps.
    sourcemap: false,
    assetsInlineLimit: 4096,
  },
  server: {
    port: 4174,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
  preview: {
    port: 4175,
    strictPort: true,
    // Temporary mobile QA uses Cloudflare Quick Tunnels. Keep this scoped to
    // that suffix instead of disabling Vite's host-header protection.
    allowedHosts: ['.trycloudflare.com'],
  },
});
