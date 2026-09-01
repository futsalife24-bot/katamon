const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

assert.match(html, /label: 'LOADOUT', sub: '装備・装飾を管理', kind: 'loadout'/,
  'タイトルのLOADOUTは日本語の装備案内を併記する');
assert.match(html, /gear: \{ asset: 'loadoutFrame'/,
  'LOADOUTだけ専用のメカニカルフレームを使う');
assert.match(html, /gear_title_menu_frame_01\.webp/);
assert.match(html, /gear_workbench_lab_background_01\.webp/);
assert.match(html, /<h2 id="gearWorkshopTitle">CATAMON LAB<\/h2>/);

for (const page of ['gear', 'weapon', 'style', 'profile']) {
  assert.match(html, new RegExp(`data-loadout-page="${page}"`), `${page} tabが必要`);
  assert.match(html, new RegExp(`data-loadout-panel="${page}"`), `${page} panelが必要`);
}

assert.match(html, /KatamonMvpShop\.equipLocked\(itemId\)/,
  '武装と装飾の変更は既存lock付きwriterだけを使う');
assert.doesNotMatch(html, /loadout[^\n]{0,80}localStorage\.setItem/i,
  'LOADOUT presentationからlocalStorageを直接変更しない');
assert.match(html, /openNameDialog\(\(\) => renderLoadoutLabPage\(\)/,
  'プロフィール名変更は既存dialogを再利用する');

for (const asset of [
  'assets/gear/ui/master/gear_title_menu_frame_01.png',
  'assets/gear/ui/master/gear_workbench_lab_background_01.png',
  'assets/gear/ui/runtime/gear_title_menu_frame_01.webp',
  'assets/gear/ui/runtime/gear_workbench_lab_background_01.webp',
]) assert.ok(fs.existsSync(path.join(root, asset)), `${asset} が必要`);

assert.match(worker, /gear_title_menu_frame_01\.webp/);
assert.match(worker, /gear_workbench_lab_background_01\.webp/);

console.log('LOADOUT / CATAMON LAB UI: title・navigation・existing authority・assets (18/18 passed)');
