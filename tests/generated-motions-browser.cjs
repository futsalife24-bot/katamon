// Real Chromium decode/draw smoke for approved catalog assets. Use --all after all 18 are packed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'content/generated-motion-manifest.json')));
const ids = Object.keys(manifest.characters);
if (process.argv.includes('--all')) assert.equal(ids.length, 18, '18体が揃っていません');
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); }
catch { try { playwright = require('@playwright/test'); }
  catch { throw new Error('Playwrightが見つかりません。既存のPlaywright node_modulesをPLAYWRIGHT_MODULEで指定してください。'); } }

const server = http.createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\//, '');
  if (name === '') {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end('<!doctype html><script src="/generated/content-studio-catalog.js"></script><script src="/shared/content-studio-motion.js"></script>');
    return;
  }
  const file = path.resolve(root, name);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
  response.setHeader('content-type', file.endsWith('.png') ? 'image/png' : file.endsWith('.json') ? 'application/json' : file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript');
  if (name === 'index.html') {
    const html = fs.readFileSync(file, 'utf8');
    const marker = 'const GENERATED_CHARACTERS = loadGeneratedCharacters(globalThis.__CONTENT_STUDIO_CATALOG__);';
    assert(html.includes(marker), 'index catalog hook changed');
    response.end(html.replace(marker, marker + `
  globalThis.__generatedMotionBindings = () => Object.fromEntries(Object.entries(LEGACY_CHARACTERS).map(([id, character]) => [id, { sheets: character.motionSheets, metadata: character.motionMetadata }]));
  globalThis.__generatedMotionGameProbe = async (id, asset) => {
    const character = CHARACTERS[id], unit = { id: 'p1', character: id, grounded: true };
    const image = new Image(); image.src = '/assets/characters/master/' + asset + '.png';
    await image.decode();
    const crop = { sx: 0, sy: 0, sw: image.naturalWidth, sh: image.naturalHeight };
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d'); ctx.translate(128, 128);
    const rect = { x: -30, y: -72, width: 60, height: 60 };
    resetBattleMotion();
    notifyBattleMotion(unit, 'fire');
    const before = battleMotion.draw(ctx, unit, character, image, crop, rect, false);
    const deadline = performance.now() + 15000;
    while (battleMotion.cache.status(character, 'fire').state === 'pending' && performance.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 25));
    const state = battleMotion.cache.status(character, 'fire').state;
    const after = battleMotion.draw(ctx, unit, character, image, crop, rect, false);
    resetBattleMotion();
    return { before, state, after };
  };`));
  } else fs.createReadStream(file).pipe(response);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: 'load' });
    for (const id of process.argv.includes('--game-only') ? [] : ids) {
      const asset = manifest.characters[id].asset;
      for (const clip of ['move-forward', 'move-backward', 'fire', 'hit', 'land']) {
        const result = await page.evaluate(async ({ id, asset, clip, base }) => {
          const character = globalThis.__CONTENT_STUDIO_CATALOG__.characters[id];
          if (!character || character.legacyTargetId !== id) throw Error('catalog binding');
          const unit = { id: 'p1', character: id, grounded: true };
          const image = new Image();
          image.src = `/assets/characters/master/${asset}.png`;
          await image.decode();
          const crop = { sx: 0, sy: 0, sw: image.naturalWidth, sh: image.naturalHeight };
          const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
          const ctx = canvas.getContext('2d');
          const rect = { x: -30, y: -72, width: 60, height: 60 };
          const sample = [];
          for (const worldLeft of [false, true]) {
            let now = 0;
            const player = new ContentStudioMotion.Player({ base, clock: () => now });
            const event = () => {
              if (clip.startsWith('move-')) {
                player.beginStep();
                player.walk(unit, (clip === 'move-forward' ? 1 : -1) * (worldLeft ? -1 : 1), worldLeft);
              } else if (now === 0) player.notify(unit, clip, character);
            };
            const draw = () => {
              canvas.width = 256; canvas.height = 256;
              ctx.save(); ctx.translate(128, 128);
              let sourceX = null, matrixSign = null;
              const original = ctx.drawImage;
              ctx.drawImage = function(bitmap, ...args) {
                if (bitmap instanceof ImageBitmap) { sourceX = args[0]; matrixSign = Math.sign(this.getTransform().a); }
                return original.call(this, bitmap, ...args);
              };
              let drawn;
              try { drawn = player.draw(ctx, unit, character, image, crop, rect, worldLeft); }
              finally { ctx.drawImage = original; ctx.restore(); }
              const pixels = ctx.getImageData(0, 0, 256, 256).data;
              let opaque = 0;
              for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 4) opaque++;
              return { drawn, sourceX, matrixSign, opaque };
            };
            event();
            const pending = draw();
            if (pending.drawn) throw Error('loading fallback missing');
            const deadline = performance.now() + 15000;
            while (player.cache.status(character, clip).state === 'pending' && performance.now() < deadline)
              await new Promise(resolve => setTimeout(resolve, 25));
            const status = player.cache.status(character, clip);
            if (status.state !== 'ready') throw Error('asset load: ' + status.state);
            const metadata = status.asset.metadata;
            const first = draw();
            now = 100;
            event();
            const next = draw();
            now = clip.startsWith('move-') ? 1000 : 2000;
            event();
            const late = draw();
            sample.push({ pending, first, next, late, width: metadata.frameWidth,
              firstFrame: clip === 'land' ? 4 : 0, nextFrame: clip === 'land' ? 5 : 1,
              loop: metadata.loop });
            player.reset();
          }
          return sample;
        }, { id, asset, clip, base });
        for (const [direction, record] of result.entries()) {
          const label = `${id}/${clip}/${direction ? 'left' : 'right'}`;
          assert.equal(record.pending.drawn, false, `${label} loading fallback`);
          assert.equal(record.first.drawn, true, `${label} first draw`);
          assert.equal(record.first.sourceX, record.firstFrame * record.width, `${label} first frame`);
          assert.equal(record.next.drawn, true, `${label} next draw`);
          assert.equal(record.next.sourceX, record.nextFrame * record.width, `${label} next frame`);
          assert(record.first.opaque > 100, `${label} canvas empty`);
          assert.equal(record.first.matrixSign, direction ? -1 : 1, `${label} facing`);
          assert.equal(record.late.drawn, record.loop, `${label} loop/end`);
          if (record.loop) assert(record.late.opaque > 100, `${label} loop canvas empty`);
        }
      }
      console.log(`${id}: 5動作 decode/draw/frame/facing OK`);
    }
    await page.close();
    const game = await browser.newPage();
    // The menu update loop resets the visual Player when gamePhase changes.
    // Freeze only RAF in this isolated page so a loading asset can finish.
    await game.addInitScript(() => {
      const original = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => original(time => {
        if (!window.__generatedMotionPauseRAF) callback(time);
      });
      window.__generatedMotionPauseRAF = true;
    });
    await game.goto(base + 'index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const loaded = await game.evaluate(() => globalThis.__generatedMotionBindings?.());
    assert(loaded, 'index.html did not initialize generated catalog');
    for (const id of ids) for (const clip of ['move-forward', 'move-backward', 'fire', 'hit', 'land']) {
      assert.equal(loaded[id].sheets[clip], manifest.characters[id].motionSheets[clip], `index ${id}/${clip}`);
    }
    for (const id of ids) {
      const probe = await game.evaluate(({ id, asset }) => globalThis.__generatedMotionGameProbe(id, asset), { id, asset: manifest.characters[id].asset });
      assert.deepEqual(probe, { before: false, state: 'ready', after: true }, `index fallback/sprite ${id}`);
    }
    await game.close();
    console.log(`index.html catalog bindings/fallback/sprite: ${ids.length}体 OK`);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
