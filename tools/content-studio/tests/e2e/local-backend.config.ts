import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../../playwright.config';
const root = fileURLToPath(new URL('../..', import.meta.url));
export default defineConfig({
  ...base, testDir: '.', testMatch: '*.backend.ts', timeout: 180000,
  outputDir: root + '/test-results/local-backend', reporter: [['list'], ['json', {outputFile:root + '/test-results/local-backend-results.json'}], ['html', { open: 'never', outputFolder: root + '/playwright-report/local-backend' }]],
  use: { ...base.use, baseURL: 'http://localhost:4177', trace: 'on', serviceWorkers: 'block' },
  webServer: { command: 'node --import tsx tests/e2e/local-backend-server.ts', cwd: root, url: 'http://localhost:4177', reuseExistingServer: false, timeout: 120000 }
});
