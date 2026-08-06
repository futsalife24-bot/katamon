import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
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
  },
});
