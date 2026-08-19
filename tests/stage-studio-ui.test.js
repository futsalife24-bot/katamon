'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const studioHtml = read('tools/stage-studio/index.html');
const studioApp = read('tools/stage-studio/app-1.7.0.js');
const studioCss = read('tools/stage-studio/styles-1.4.0-mvp.css');
const studioSw = read('tools/stage-studio/sw.js');
const fontCss = read('assets/fonts/katamon-fonts.css');

test('Stage Studio shares the two-font Katamon hierarchy', () => {
  assert.match(studioHtml, /assets\/fonts\/katamon-fonts\.css/);
  assert.match(fontCss, /--katamon-font-ui:\s*"RocknRoll One"/);
  assert.match(fontCss, /--katamon-font-display:\s*"Reggae One"/);
  assert.match(studioCss, /:root\s*\{[\s\S]*font-family:\s*var\(--katamon-font-ui\)/);
  assert.match(studioCss, /\.app-header h1\s*\{[^}]*var\(--katamon-font-display\)/);
  assert.match(studioCss, /\.screen-heading h2\s*\{[^}]*var\(--katamon-font-display\)/);
  assert.match(studioSw, /rocknroll-one-regular\.ttf/);
  assert.match(studioSw, /reggae-one-display\.woff2/);
  assert.match(studioSw, /1\.8\.1-character-assets/);
});

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
  const windIndex = playtestHtml.indexOf('id="windEnabled"');

  assert.ok(canvasIndex >= 0 && canvasIndex < dockStart);
  assert.ok(dockStart >= 0 && dockStart < windIndex);
  for (const id of ['moveTestLeft', 'fireTest', 'moveTestRight', 'resetTest', 'shotAngle', 'shotPower']) {
    const controlIndex = playtestHtml.indexOf(`id="${id}"`);
    assert.ok(controlIndex > dockStart && controlIndex < windIndex, `${id} must remain inside the map dock`);
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
    'dirano.webp', 'eyebolt.webp', 'fenice.webp', 'gorocca.webp'
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
  assert.match(studioApp, /const hasMaterialOverrides = Array\.isArray\(state\.stage\.terrain && state\.stage\.terrain\.materialSegments\)/);
  assert.match(studioApp, /const material = state\.stage\.materials && \(state\.stage\.materials\.find\(\(item\) => item && item\.id === 'terrain'\)/);
  assert.match(studioApp, /const steel = material\.id === 'steel' && !hasMaterialOverrides;/);
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
  assert.match(studioCss, /\.terrain-tool-menu\s*\{[^}]*position:\s*absolute;[^}]*grid-template-columns:\s*repeat\(5,/);
  assert.match(terrainHtml, /id="terrainToolMenuToggle"[^>]*aria-expanded="false"/);
  assert.match(terrainHtml, /id="terrainToolMenu"[^>]*hidden/);
  assert.match(studioApp, /function toggleTerrainToolMenu\(/);
  assert.match(studioApp, /function collapseTerrainToolMenu\(/);
  assert.match(studioCss, /\.terrain-inspector-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(5,/);
  assert.match(studioApp, /function nearestSafeCharacterGuide\(/);
  assert.match(studioApp, /function snapInvalidCharacterGuides\(/);
  assert.match(studioApp, /\.filter\(\(item\) => item\.collision\)/);
  assert.match(studioApp, /state\.characterGuides\[placement\.index\] = placement\.guide/);
  assert.match(studioApp, /snapCharacterGuides.*snapInvalidCharacterGuides/);
});

test('terrain settings use a floating palette that collapses after choosing a value', () => {
  const canvasEnd = studioHtml.indexOf('</div>', studioHtml.indexOf('data-testid="terrain-canvas"'));
  const paletteIndex = studioHtml.indexOf('data-testid="terrain-palette-toggle"');
  assert.ok(paletteIndex > canvasEnd, '設定ボタンをステージ画像の外へ置く');
  assert.match(studioHtml, /id="terrainInspector"[^>]*data-open="false"[^>]*hidden/);
  assert.match(studioHtml, /id="terrainInspectorClose"/);
  assert.match(studioCss, /\.stage-orientation-button, \.stage-setting-button\s*\{[^}]*min-height:\s*var\(--tap\);/);
  assert.match(studioCss, /\.terrain-stage-controls\s*\{[^}]*display:\s*grid;/);
  assert.match(studioCss, /\.terrain-inspector\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*30;/);
  assert.match(studioCss, /\.terrain-inspector-panel\s*\{[^}]*overflow-y:\s*auto;/);
  assert.match(studioApp, /function collapseTerrainInspector\(/);
  assert.match(studioApp, /function toggleTerrainInspector\(/);
  assert.match(studioApp, /\[data-terrain-panel-content\] input, \[data-terrain-panel-content\] select/);
  assert.match(studioApp, /control\.closest\('\[data-terrain-panel-content="text"\]'\)/);
});

test('text terrain converts safe text into the existing destructible grid', () => {
  assert.match(studioHtml, /id="toolText"[^>]*data-tool="text"/);
  assert.match(studioHtml, /id="terrainTextInput"[^>]*maxlength="8"/);
  assert.match(studioHtml, /id="terrainTextFont"[\s\S]*value="rock"[\s\S]*value="reggae"/);
  assert.match(studioHtml, /id="placeTextCenter"/);
  assert.match(studioHtml, /id="terrainTextPlacementMode"/);
  assert.match(studioHtml, /id="confirmTextPlacement"/);
  assert.match(studioApp, /function textTerrainSettings\(/);
  assert.match(studioApp, /function textTerrainPlacementMode\(/);
  assert.match(studioApp, /textTerrainDragActive/);
  assert.match(studioApp, /continuous: true/);
  assert.match(studioApp, /function rasterizeTextTerrain\(/);
  assert.match(studioApp, /document\.fonts\.load/);
  assert.match(studioApp, /getImageData\(/);
  assert.match(studioApp, /state\.grid\[index\] = next/);
  assert.match(studioApp, /syncTerrainToStage\(\);[\s\S]*resetPlaytest\(false\);[\s\S]*markDirty\(\);/);
  assert.match(studioApp, /replace\(\/\[\\u0000-\\u001f\\u007f\]\//);
});

test('editing canvases expose an external landscape control with a safe iOS fallback', () => {
  assert.equal((studioHtml.match(/data-orientation-toggle/g) || []).length, 3);
  assert.equal((studioHtml.match(/data-orientation-guide/g) || []).length, 3);
  const terrainCanvasEnd = studioHtml.indexOf('</div>', studioHtml.indexOf('data-testid="terrain-canvas"'));
  const orientationIndex = studioHtml.indexOf('data-testid="orientation-toggle"');
  assert.ok(orientationIndex > terrainCanvasEnd, '横画面ボタンをステージ画像の外へ置く');
  assert.doesNotMatch(studioHtml.slice(studioHtml.indexOf('<div class="canvas-card">', studioHtml.indexOf('data-screen="terrain"')), terrainCanvasEnd), /<button/);
  assert.match(studioCss, /\.stage-orientation-button, \.stage-setting-button\s*\{[^}]*min-height:\s*var\(--tap\);/);
  assert.match(studioCss, /\.orientation-guide\s*\{[^}]*position:\s*absolute;/);
  assert.match(studioApp, /function togglePreferredOrientation\(/);
  assert.match(studioApp, /typeof orientation\.lock !== 'function'/);
  assert.match(studioApp, /requestFullscreen\(\{ navigationUI: 'hide' \}\)/);
  assert.match(studioApp, /画面回転ロックを解除して、端末を横向きにしてください/);
  assert.match(studioApp, /addEventListener\('orientationchange', updateOrientationControls\)/);
});

test('Stage Studio offers the whole-stage steel material and exports its indestructible declaration', () => {
  assert.match(studioHtml, /<option value="steel">壊れない鋼鉄<\/option>/);
  assert.match(studioApp, /function selectedTerrainMaterial\(\)/);
  assert.match(studioApp, /id: 'steel', type: 'indestructible', destructible: false/);
});

test('game-style UI and PWA shell ship the new visual assets with a cache bump', () => {
  assert.match(studioCss, /--primary:\s*#c78335/);
  assert.match(studioCss, /--text:\s*#fff5dc/);
  assert.match(studioCss, /\.terrain-tool-menu\s*\{[^}]*grid-template-columns:\s*repeat\(5,/);
  assert.match(studioSw, /CACHE_NAME\s*=\s*`\$\{CACHE_PREFIX\}1\.8\.1-character-assets`/);
  assert.match(studioSw, /stage-grass-bg\.jpg/);
  assert.match(studioSw, /characters\/runtime\/dirano\.webp/);
  assert.match(studioHtml, /styles-1\.4\.0-mvp\.css/);
  assert.match(studioHtml, /app-1\.7\.0\.js/);
  assert.match(studioSw, /request\.destination === 'script'[\s\S]*fetch\(request, \{ cache: 'no-cache' \}\)[\s\S]*cache\.match\(request/);
  assert.doesNotMatch(studioSw, /['"]\.\/(?:styles\.css|app\.js|app-1\.4\.0-mvp\.js)['"]/);
  const gameBuild = read('index.html').match(/const BUILD_ID = '([^']+)'/)[1];
  const gameCache = read('sw.js').match(/const CACHE_VERSION = 'katamon-pwa-([^']+)'/)[1];
  assert.equal(gameBuild, gameCache);
});
