import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../../playwright.config';
const root = fileURLToPath(new URL('../..', import.meta.url));
export default defineConfig({
  ...base,
  testDir: '.', testMatch: '*.server.ts',
  outputDir: `${root}/test-results/server-safety`,
  reporter: [['list'], ['html', { open: 'never', outputFolder: `${root}/playwright-report/server-safety` }]],
  use: { ...base.use, baseURL: 'http://127.0.0.1:4176', trace: 'on', serviceWorkers: 'block' },
  webServer: { command: 'node tests/e2e/serve-server-mode.mjs', cwd: root, url: 'http://127.0.0.1:4176', reuseExistingServer: false, timeout: 180000 },
});
