const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'gear', 'asset-manifest.json'), 'utf8'));
let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`  ok ${name}`); }

test('BGM専用導線はMUSIC ROOMとして表示し内部soundTest idを維持する', () => {
  assert.match(html, /id: 'soundTest'[^\n]+label: 'MUSIC ROOM'[^\n]+sub: 'BGMコレクション'/);
  assert.match(html, /drawOutlinedText\('MUSIC ROOM', soundTestModal/);
  assert.match(html, /if \(item\.id === 'soundTest'\) return 'BGMコレクション'/);
  assert.doesNotMatch(html, /label: 'サウンドテスト'/);
});

test('タイトルLOADOUTを大型化しMUSIC ROOMと非重複の配置にする', () => {
  assert.match(html, /gear: \{ asset: 'loadoutFrame', x: 270, y: 727, w: 301, h: 82 \}/);
  assert.match(html, /const titleGearBtn = \{ x: 270, y: 727, w: 283, h: 63 \}/);
  assert.match(html, /soundTest: \{ asset: 'shield', x: 395, y: 829, w: 130, h: 116 \}/);
  assert.match(html, /ctx\.font = `400 24px \$\{UI_FONT_DISPLAY\}`/);
});

test('猛攻・会心・背水はv2紋章へ差し替え、他5セットと合成方式を維持する', () => {
  const expected = {
    assault: 'runtime/emblems/gear_emblem_assault_02.png',
    critical: 'runtime/emblems/gear_emblem_critical_02.png',
    last_stand: 'runtime/emblems/gear_emblem_laststand_02.png',
  };
  for (const [setId, runtime] of Object.entries(expected)) {
    const set = manifest.sets.find((entry) => entry.id === setId);
    assert.equal(set.runtime, runtime);
    assert.ok(fs.existsSync(path.join(root, 'assets', 'gear', runtime)));
    assert.match(html, new RegExp(`${setId}: 'assets/gear/${runtime.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  }
  assert.equal(manifest.sets.length, 8);
  assert.equal(manifest.completedCombinationImages, 0);
  assert.match(html, /brightness\(1\.24\) saturate\(1\.12\)/);
});

test('GARAGE戻るは意味のある2行へ固定し孤立改行を許さない', () => {
  assert.equal((html.match(/class="gearButton gearBackButton"/g) || []).length, 2);
  assert.equal((html.match(/<span>GARAGEへ<\/span><span>戻る<\/span>/g) || []).length, 2);
  assert.match(html, /\.gearBackButton span\{display:block;white-space:nowrap\}/);
});

test('GuideはWorkbenchと同じ左右3段順で固定・可変メインを説明する', () => {
  assert.match(html, /\['auxiliary', 'barrel', 'sight', 'armor', 'engine', 'core'\]/);
  assert.match(html, /auxiliary: '左上', barrel: '右上', sight: '左中', armor: '右中', engine: '左下', core: '右下'/);
  assert.match(html, /barrel: '攻撃', armor: 'HP', core: '防御'/);
  assert.match(html, /slot\.mainKind === 'fixed' \? gearGuideFixedMainLabels\[slot\.id\] : 'ランダム'/);
});

test('背水は2SETと4SETの同時適用・上書きをpresentationで明示する', () => {
  assert.match(html, /HP50%以下では2SETの攻撃\+10%と、4SETの次攻撃\+15%が別の補正として両方有効/);
  assert.match(html, /HP\$\{\(effect\.hpThresholdBp \/ 100\).*gearSetPercent\(effect\.lowHpValueBp\).*上書き（重複なし）/s);
  const presentation = html.slice(html.indexOf('const gearSetStatLabels'), html.indexOf('function gearCurrentGear'));
  assert.doesNotMatch(presentation, /enhanceStoredGearAtomic|saveGearState|persist|transaction/i);
});

console.log(`Gear emblem / guide polish Phase 4Q: ${passed}/6 passed`);
