const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

function pngDimensions(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegDimensions(buffer) {
  assert.equal(buffer.readUInt16BE(0), 0xffd8);
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const length = buffer.readUInt16BE(offset);
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame) return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    offset += length;
  }
  assert.fail('weekday dungeon runtime JPEG has no Start Of Frame marker');
}

const checks = [
  ['weekday overlay exposes the stable controls and 540x720 canvas', () => {
    for (const id of ['weekdayDungeon', 'weekdayDungeonCanvas', 'weekdayDungeonOpen', 'weekdayDungeonClose', 'weekdayDungeonFire', 'weekdayDungeonSlotChoices', 'weekdayDungeonSlotInstruction', 'weekdayDungeonAimAngle', 'weekdayDungeonAimPower', 'weekdayDungeonAimReadout', 'weekdayDungeonStatus']) {
      assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(html, /id="weekdayDungeonCanvas"[^>]*width="540"[^>]*height="720"/);
  }],
  ['Sunday selection is visible and narrow touch targets use a 2 by 3 grid', () => {
    assert.match(html, /id="weekdayDungeonSlotInstruction"[^>]*>日曜日は報酬にしたい部位/);
    assert.match(html, /aria-describedby="weekdayDungeonSlotInstruction"/);
    assert.match(html, /@media\(max-width:380px\)\{[\s\S]*?\.weekdayDungeonSlotChoices\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
    assert.match(html, /\.weekdayDungeonSlotChoice\{min-width:0;min-height:44px/);
    assert.match(html, /@media\(max-width:380px\)\{[\s\S]*?\.weekdayDungeonSlotChoice\{min-height:44px/);
    assert.match(html, /\.weekdayDungeonActions \.gearButton\{min-height:44px\}/);
  }],
  ['aim is keyboard-accessible with live readable values and disabled state', () => {
    assert.match(html, /id="weekdayDungeonAimAngle" type="range" min="10" max="80"/);
    assert.match(html, /id="weekdayDungeonAimPower" type="range" min="28" max="120"/);
    assert.match(html, /id="weekdayDungeonAimReadout"[^>]*>角度 45°・強さ 84/);
    assert.match(html, /function weekdayDungeonSyncAimControls\(/);
    assert.match(html, /weekdayDungeonAimControlsEl\.disabled = !editable/);
    assert.match(html, /weekdayDungeonAimAngleEl\?\.addEventListener\('input', adjustAimFromControls\)/);
    assert.match(html, /weekdayDungeonAimPowerEl\?\.addEventListener\('input', adjustAimFromControls\)/);
  }],
  ['dialog keeps focus contained, returns it on close, and honors Escape while busy', () => {
    assert.match(html, /function weekdayDungeonHandleKeydown\(event\)/);
    assert.match(html, /event\.key === 'Escape'/);
    assert.match(html, /document\.addEventListener\('keydown', weekdayDungeonHandleKeydown\)/);
    assert.match(html, /function weekdayDungeonFocusableElements\(\)/);
    assert.match(html, /returnFocus && document\.contains\(returnFocus\)\) returnFocus\.focus\(\)/);
    assert.match(html, /closeWeekdayDungeon\(force = false, restoreFocus = true\)/);
  }],
  ['Garage has a dedicated weekday dungeon card and entry button', () => {
    assert.match(html, /id="gearWeekdayDungeonCard"/);
    assert.match(html, /id="gearWeekdayDungeonEntry"/);
    assert.match(html, /id="weekdayDungeon"/);
  }],
  ['weekday dungeon uses the vault runtime art and source label', () => {
    assert.match(html, /assets\/weekday-dungeon\/runtime\/weekday_dungeon_vault_01\.jpg/);
    assert.match(html, /WEEKDAY DUNGEON/);
    assert.ok(fs.existsSync(path.join(root, 'assets/weekday-dungeon/runtime/weekday_dungeon_vault_01.jpg')),
      'weekday dungeon runtime background must be checked in');
  }],
  ['weekday background starts loading only on the first dungeon open while cache registration remains intact', () => {
    const loader = html.indexOf('function weekdayDungeonEnsureBackground()');
    assert.ok(loader > 0, 'background loader is required');
    assert.doesNotMatch(html.slice(0, loader), /weekdayDungeonBackground\.src\s*=/);
    assert.match(html.slice(loader), /weekdayDungeonUi\.backgroundRequested = true;[\s\S]*?weekdayDungeonBackground\.src = weekdayDungeonCanvas\.dataset\.background/);
    assert.match(html, /weekdayDungeonEnsureBackground\(\);/);
  }],
  ['generated master stays portrait and runtime is optimized to 720x1280', () => {
    const master = fs.readFileSync(path.join(root, 'assets/weekday-dungeon/master/weekday_dungeon_vault_01.png'));
    const runtime = fs.readFileSync(path.join(root, 'assets/weekday-dungeon/runtime/weekday_dungeon_vault_01.jpg'));
    const masterSize = pngDimensions(master);
    assert.ok(masterSize.width >= 900 && masterSize.height >= 1600 && masterSize.height > masterSize.width);
    assert.deepEqual(jpegDimensions(runtime), { width: 720, height: 1280 });
    assert.ok(runtime.length <= 400 * 1024, `runtime background is too large: ${runtime.length} bytes`);
  }],
  ['integration module scripts load before the inline app script', () => {
    const firstInline = html.indexOf('<script>');
    assert.ok(firstInline > 0, 'inline app script marker is required');
    const modulePaths = [...html.matchAll(/<script[^>]+src="([^"]*weekday[^\"]*)"[^>]*><\/script>/gi)].map((match) => match[1]);
    assert.ok(modulePaths.length >= 1, 'weekday integration must have an external module');
    for (const modulePath of modulePaths) {
      const external = html.indexOf(`src="${modulePath}"`);
      assert.ok(external >= 0 && external < firstInline, `${modulePath} must precede inline app code`);
      const sourcePath = path.join(root, modulePath.replace(/^\.\//, ''));
      if (fs.existsSync(sourcePath)) {
        const source = fs.readFileSync(sourcePath, 'utf8');
        assert.doesNotMatch(source, /Firebase|firebase|ONLINE|online/i, `${modulePath} must remain local`);
      }
    }
  }],
  ['weekday integration remains local and does not wire Firebase or ONLINE', () => {
    const marker = html.indexOf('id="weekdayDungeon"');
    const end = html.indexOf('<div id="gearDropReveal"', marker);
    assert.ok(marker >= 0);
    assert.ok(end > marker, 'weekday overlay must end before the shared reward reveal');
    const section = html.slice(marker, end);
    assert.doesNotMatch(section, /Firebase|firebase|ONLINE|online/i);
  }],
  ['production integration does not expose test-only control hooks', () => {
    assert.doesNotMatch(html, /KatamonWeekdayDungeonUi|setAimForTest|fireForTest|resetAnimationForTest/);
  }],
  ['service-worker cache eventually includes the weekday runtime art', () => {
    assert.match(sw, /weekday_dungeon_vault_01\.jpg/);
  }],
  ['weekday animation still respects reduced-motion', () => {
    assert.match(html, /weekdayDungeonAnimate[\s\S]*?prefers-reduced-motion: reduce/);
  }],
];

let passed = 0;
for (const [name, check] of checks) {
  try { check(); passed += 1; console.log(`  ok ${name}`); }
  catch (error) { console.error(`  NG ${name}`); throw error; }
}
console.log(`weekday-dungeon-ui: ${passed}/${checks.length} passed`);
