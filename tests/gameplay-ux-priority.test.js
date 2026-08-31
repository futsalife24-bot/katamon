const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const harness = require('./seatharness.js');

const kt = harness.kt();
const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

for (const speed of [280, 500, 1000]) {
  const duration = kt.trajectoryPreviewDurationForTest(speed, 0, 650);
  assert.ok(speed * duration >= 180 - 1e-7, `horizontal guide must reach 180px at normal speed ${speed}`);
}
const weakDuration = kt.trajectoryPreviewDurationForTest(80, 0, 650);
assert.equal(weakDuration, 0.7, 'weak horizontal shots keep a bounded guide duration');

assert.match(source, /function ensureSoundTestGraph\(\)/);
assert.match(source, /bgmSourceNodes\.soundTest = ac\.createMediaElementSource\(soundTestAudio\)/);
assert.match(source, /soundTestGain\.gain\.value = target/);

assert.match(source, /data-gear-current-detail=/);
assert.match(source, /所持品で詳細を見る/);
assert.match(source, /報酬を受け取って連勝を終了しますか？/);
assert.match(source, /受取後は連勝が0に戻ります。この操作は取り消せません。/);

console.log('gameplay UX priority targeted tests: PASS');
