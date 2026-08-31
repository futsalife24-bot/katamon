const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const checks = [
  ['Storageから指定BOXを開く正式導線を持つ', () => {
    assert.match(html, /id="gearStorageTargetedBox"/);
    assert.match(html, /id="gearTargetedBoxOverlay"/);
    assert.match(html, /persistOpenTargetedBox\(request, localStorage\)/);
  }],
  ['部位・set・部位+setの3種類を正本IDで選べる', () => {
    for (const kind of ['slot', 'set', 'slot_set']) assert.match(html, new RegExp(`data-gear-targeted-kind="${kind}"`));
    assert.match(html, /domain\.getTargetedBoxQuote\(gearTargetedBoxUi\.kind, constraints\)/);
  }],
  ['品質と費用は既存Domain・Foundation正本だけから表示する', () => {
    assert.match(html, /highestTargetedBoxQualityProfileId\(foundation\)/);
    assert.match(html, /model\.quote\.blueprintShards/);
    assert.doesNotMatch(html, /gearTargetedBox[^\n]{0,120}(?:100|300)\s*[-+*/]/);
  }],
  ['製作結果は既存未受取報酬とDrop Revealへ接続する', () => {
    assert.match(html, /presentGearRewardId\(result\.reward\.rewardId, true\)/);
    assert.match(html, /reward\.sourceId === 'targeted_box' \? 'TARGETED BOX'/);
  }],
  ['UIは抽選結果を事前表示せず二重送信をbusyで防ぐ', () => {
    assert.match(html, /if \(gearTargetedBoxUi\.busy \|\| gearStorageUi\.mutationBlocked\) return false/);
    assert.match(html, /gearTargetedBoxUi\.busy = true/);
    assert.doesNotMatch(html, /gearTargetedBox(?:Preview|Reroll|RollResult)/);
    assert.match(html, /gearTargetedBoxUi\.operationId = `ui:\$\{globalThis\.crypto\.randomUUID\(\)\}`/);
    assert.match(html, /const rewardId = `targeted-box:\$\{gearTargetedBoxUi\.operationId\}`/);
  }],
  ['targeted box tests are part of the normal Gear reward CI command', () => {
    assert.match(packageJson.scripts['test:gear-rewards'], /gear-targeted-box\.test\.js/);
    assert.match(packageJson.scripts['test:gear-targeted-box'], /^node tests\/gear-targeted-box\.test\.js && node tests\/gear-targeted-box-ui\.test\.js$/);
  }],
];

let passed = 0;
for (const [name, check] of checks) {
  try { check(); passed += 1; console.log(`  ok ${name}`); }
  catch (error) { console.error(`  NG ${name}`); throw error; }
}
console.log(`gear-targeted-box-ui: ${passed}/${checks.length} passed`);
