'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const studioHtml = read('tools/stage-studio/index.html');
const studioApp = read('tools/stage-studio/app-1.2.0-mvp.js');
const studioCss = read('tools/stage-studio/styles-1.2.0-mvp.css');
const studioSw = read('tools/stage-studio/sw.js');

test('Stage Studio presents the requested eight-screen mobile flow', () => {
  const screenNames = Array.from(studioHtml.matchAll(/<section\b[^>]*data-screen="([^"]+)"/g), (match) => match[1]);
  const navNames = Array.from(studioHtml.matchAll(/class="step-tab[^"]*"[^>]*data-step="([^"]+)"/g), (match) => match[1]);
  const expected = ['home', 'new', 'generate', 'terrain', 'spawns', 'playtest', 'validate', 'export'];
  assert.deepEqual(screenNames, expected);
  assert.deepEqual(navNames, expected);
  assert.match(studioApp, /SCREEN_ALIASES\s*=\s*Object\.freeze\(\{\s*gimmicks:\s*'playtest',\s*appearance:\s*'terrain'\s*\}\)/);
  assert.doesNotMatch(studioHtml, /data-screen="(?:gimmicks|appearance)"/);
});

test('usage is always visible before device status, while appearance and wind are merged', () => {
  const usageIndex = studioHtml.indexOf('class="panel usage-panel"');
  const deviceIndex = studioHtml.indexOf('class="panel stats-panel"');
  const terrainIndex = studioHtml.indexOf('data-screen="terrain"');
  const spawnIndex = studioHtml.indexOf('data-screen="spawns"');
  const playtestIndex = studioHtml.indexOf('data-screen="playtest"');
  const validateIndex = studioHtml.indexOf('data-screen="validate"');
  assert.ok(usageIndex >= 0 && usageIndex < deviceIndex);
  assert.doesNotMatch(studioHtml.slice(usageIndex, deviceIndex), /<details/);
  assert.ok(studioHtml.indexOf('id="backgroundMode"') > terrainIndex && studioHtml.indexOf('id="backgroundMode"') < spawnIndex);
  assert.ok(studioHtml.indexOf('id="windEnabled"') > playtestIndex && studioHtml.indexOf('id="windEnabled"') < validateIndex);
});

test('playtest actions stay in a dock directly below the map while wind settings follow later', () => {
  const playtestStart = studioHtml.indexOf('data-screen="playtest"');
  const playtestEnd = studioHtml.indexOf('data-screen="validate"');
  const playtestHtml = studioHtml.slice(playtestStart, playtestEnd);
  const canvasIndex = playtestHtml.indexOf('data-testid="test-canvas"');
  const dockStart = playtestHtml.indexOf('data-testid="playtest-controls"');
  const dockEnd = playtestHtml.indexOf('</div>\n        </div>', dockStart);
  const windIndex = playtestHtml.indexOf('id="windEnabled"');

  assert.ok(canvasIndex >= 0 && canvasIndex < dockStart);
  assert.ok(dockStart >= 0 && dockStart < dockEnd && dockEnd < windIndex);
  for (const id of ['moveTestLeft', 'fireTest', 'moveTestRight', 'resetTest', 'shotAngle', 'shotPower']) {
    const controlIndex = playtestHtml.indexOf(`id="${id}"`);
    assert.ok(controlIndex > dockStart && controlIndex < dockEnd, `${id} must remain inside the map dock`);
  }
  assert.match(studioCss, /\.playtest-stage-shell\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;/);
  assert.match(studioCss, /\.test-controls\s*\{[^}]*grid-template-columns:\s*repeat\(4,/);
  assert.match(studioCss, /@media \(orientation:\s*landscape\)[\s\S]*?\.playtest-stage-shell\s*\{[^}]*position:\s*sticky;[^}]*grid-template-columns:[^}]*minmax\(300px,\s*1fr\);/);
  assert.match(studioCss, /\.playtest-stage-shell > \.canvas-card\s*\{[^}]*max-width:\s*none;[^}]*border-radius:\s*var\(--radius\)\s*0\s*0\s*var\(--radius\);/);
  assert.match(studioCss, /\.playtest-control-dock\s*\{[^}]*border-left:\s*0;[^}]*border-radius:\s*0\s*var\(--radius\)\s*var\(--radius\)\s*0;/);
});

test('all editing canvases use game assets, terrain texture and real character dimensions', () => {
  for (const asset of [
    'stage-grass-bg.jpg', 'stage-desert-bg.jpg', 'stage-snow-bg.jpg', 'stage-volcanic-bg.jpg',
    'kyoryu.webp', 'medama.webp', 'tori.webp', 'iwa.webp'
  ]) assert.match(studioApp, new RegExp(asset.replace('.', '\\.')));
  assert.match(studioApp, /const SPRITE_SIZE = 78;/);
  assert.match(studioApp, /const UNIT_HIT_RADIUS = 30;/);
  assert.match(studioApp, /const UNIT_HIT_RISE = 23;/);
  assert.match(studioApp, /function characterCollision\(/);
  assert.match(studioApp, /for \(let column = minColumn; column <= maxColumn; column\+\+\)/);
  assert.match(studioApp, /for \(let row = minRow; row <= maxRow; row\+\+\)/);
  assert.doesNotMatch(studioApp, /for \(const ratio of \[0\.55, 1\]\)/);
  assert.match(studioApp, /settings\.team === 'cpu' \|\| settings\.team === 'enemy'/);
  assert.match(studioApp, /spawn\.team === 'player' \? 'blue' : 'red'/);
  assert.match(studioApp, /function drawTerrain\(/);
  assert.match(studioApp, /dirtBottom: mixHexColor\(terrainTop, '#000000', 0\.58\)/);
  assert.match(studioApp, /rim: mixHexColor\(terrainTop, '#ffffff', 0\.34\)/);
  assert.match(studioApp, /rimShadow: mixHexColor\(terrainTop, '#000000', 0\.36\)/);
  assert.match(studioApp, /Array\.isArray\(snapshot\.characterGuides\) && snapshot\.characterGuides\.length[\s\S]*?: null/);
  assert.match(studioApp, /state\.ready && state\.documentStarted && state\.stage && previousScreen !== screen/);
  assert.match(studioApp, /drawStageScene\(\$\('terrainCanvas'\)/);
  assert.match(studioApp, /drawStageScene\(\$\('spawnCanvas'\)/);
  assert.match(studioApp, /drawStageScene\(\$\('testCanvas'\)/);
});

test('terrain editor uses a canvas-first workspace with contextual inspector and safe character recovery', () => {
  const terrainStart = studioHtml.indexOf('data-screen="terrain"');
  const terrainEnd = studioHtml.indexOf('data-screen="spawns"');
  const terrainHtml = studioHtml.slice(terrainStart, terrainEnd);
  const canvasIndex = terrainHtml.indexOf('data-testid="terrain-canvas"');
  const toolsIndex = terrainHtml.indexOf('data-testid="terrain-tools"');
  const recoveryIndex = terrainHtml.indexOf('id="snapCharacterGuides"');
  const inspectorIndex = terrainHtml.indexOf('data-testid="terrain-inspector"');
  assert.ok(canvasIndex >= 0 && canvasIndex < toolsIndex && toolsIndex < recoveryIndex && recoveryIndex < inspectorIndex);
  for (const panel of ['brush', 'shape', 'display', 'appearance']) {
    assert.match(terrainHtml, new RegExp(`data-terrain-panel="${panel}"`));
    assert.match(terrainHtml, new RegExp(`data-terrain-panel-content="${panel}"`));
  }
  assert.match(studioCss, /\.terrain-workspace\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;/);
  assert.match(studioCss, /\.terrain-tool-row\s*\{[^}]*grid-template-columns:\s*repeat\(4,/);
  assert.match(studioCss, /\.terrain-inspector-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(4,/);
  assert.match(studioApp, /function nearestSafeCharacterGuide\(/);
  assert.match(studioApp, /function snapInvalidCharacterGuides\(/);
  assert.match(studioApp, /\.filter\(\(item\) => item\.collision\)/);
  assert.match(studioApp, /state\.characterGuides\[placement\.index\] = placement\.guide/);
  assert.match(studioApp, /snapCharacterGuides.*snapInvalidCharacterGuides/);
});

test('steel remains a disabled future material and cannot enter exported state', () => {
  assert.match(studioHtml, /<option value="steel" disabled>壊れない鋼鉄（準備中）<\/option>/);
  assert.match(studioApp, /state\.stage\.materials = \[\{ id: 'terrain', type: 'destructible', destructible: true, color: \$\('terrainColor'\)\.value \}\];/);
  assert.doesNotMatch(studioApp, /id:\s*['"]steel['"]/);
});

test('game-style UI and PWA shell ship the new visual assets with a cache bump', () => {
  assert.match(studioCss, /--primary:\s*#c78335/);
  assert.match(studioCss, /--text:\s*#fff5dc/);
  assert.match(studioCss, /grid-template-columns:\s*repeat\(4,/);
  assert.match(studioSw, /CACHE_NAME\s*=\s*`\$\{CACHE_PREFIX\}1\.2\.0-mvp`/);
  assert.match(studioSw, /stage-grass-bg\.jpg/);
  assert.match(studioSw, /kyoryu\.webp/);
  assert.match(studioHtml, /styles-1\.2\.0-mvp\.css/);
  assert.match(studioHtml, /app-1\.2\.0-mvp\.js/);
  assert.doesNotMatch(studioSw, /['"]\.\/(?:styles\.css|app\.js)['"]/);
  const gameBuild = read('index.html').match(/const BUILD_ID = '([^']+)'/)[1];
  const gameCache = read('sw.js').match(/const CACHE_VERSION = 'katamon-pwa-([^']+)'/)[1];
  assert.equal(gameBuild, gameCache);
});
