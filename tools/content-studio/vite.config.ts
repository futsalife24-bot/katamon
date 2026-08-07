import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const legacyAssets = new Set(['kyoryu', 'medama', 'iwa', 'tori', 'barugerukan', 'nisenmono', 'burumutan', 'sumoeru', 'do-rednote', 'mocchario', 'mecha', 'akuma', 'jinba', 'kishi', 'neko', 'shinigami']);

function repositoryAssetMiddleware() {
  return async (request: { url?: string }, response: { statusCode: number; setHeader(name: string, value: string): void; end(body?: Uint8Array): void }, next: () => void) => {
    const match = /^\/([a-z0-9-]+)\.(webp|png)$/u.exec(request.url ?? '');
    if (!match || !legacyAssets.has(match[1])) return next();
    try {
      const bytes = await readFile(resolve(repositoryRoot, 'assets', `${match[1]}.${match[2]}`));
      response.setHeader('Content-Type', match[2] === 'webp' ? 'image/webp' : 'image/png');
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
