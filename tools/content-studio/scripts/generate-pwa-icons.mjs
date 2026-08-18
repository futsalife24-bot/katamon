import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = join(root, 'public', 'icons');

async function rasterize(page, sourceName, outputName, size) {
  const svg = await readFile(join(outputDirectory, sourceName), 'utf8');
  const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>*{box-sizing:border-box}html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden}img{display:block;width:${size}px;height:${size}px}</style><img alt="" src="${source}">`);
  await page.locator('img').screenshot({ path: join(outputDirectory, outputName), omitBackground: true });
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await rasterize(page, 'icon.svg', 'icon-192.png', 192);
  await rasterize(page, 'icon.svg', 'icon-512.png', 512);
  await rasterize(page, 'maskable.svg', 'maskable-512.png', 512);
} finally {
  await browser.close();
}
