const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const weekdayDomain = require(path.join(root, 'shared/gear-weekday-dungeon.js'));

function sourceAfter(marker) {
  const start = html.indexOf(marker);
  assert.ok(start >= 0, `missing source marker: ${marker}`);
  return html.slice(start);
}

const checks = [
  ['Garage keeps the weekday entry, while the old portrait overlay is gone', () => {
    assert.match(html, /id="gearWeekdayDungeonCard"/);
    assert.match(html, /id="gearWeekdayDungeonEntry"/);
    for (const obsoleteId of [
      'weekdayDungeon', 'weekdayDungeonCanvas', 'weekdayDungeonClose', 'weekdayDungeonFire',
      'weekdayDungeonSlotChoices', 'weekdayDungeonAimAngle', 'weekdayDungeonAimPower',
      'weekdayDungeonAimReadout',
    ]) assert.doesNotMatch(html, new RegExp(`id="${obsoleteId}"`));
    assert.doesNotMatch(html, /weekdayDungeonEnsureBackground|weekdayDungeonAnimate|weekdayDungeonSyncAimControls/);
  }],
  ['weekday play uses the existing Battle canvas and a dedicated battle mode', () => {
    assert.match(html, /<canvas id="game"[^>]*data-testid="battle-canvas"/);
    assert.match(html, /battleMode\s*=\s*['"]weekday['"]/);
    assert.match(html, /function weekdayDungeonBattleActive\(/);
    assert.match(html, /function computeLaunchVelocity\(/);
    assert.match(html, /function fireProjectile\(/);
    assert.match(html, /weekdayDungeonBattleActive\(\)[\s\S]{0,500}?computeLaunchVelocity|computeLaunchVelocity[\s\S]{0,1500}?weekdayDungeonBattle/);
    assert.match(html, /fireProjectile\([\s\S]{0,700}?weekdayDungeon/);
  }],
  ['weekday arena is a calm one-player flat battlefield', () => {
    assert.deepEqual(weekdayDomain.BATTLE_PLAYFIELD, { width: 1440, height: 720, centerX: 720, groundY: 510, projectileStartAboveGround: 16, minX: -30, maxX: 1470 });
    assert.match(html, /const groundY = domain\.BATTLE_PLAYFIELD\.groundY/);
    assert.match(html, /groundY\s*!==\s*weekdayDungeonBattleField\.groundY/);
    assert.match(html, /wind\s*=\s*\{ dir: 0, strength: 0 \}/);
    const weekdaySection = sourceAfter('function weekdayDungeonBattleActive(');
    assert.match(weekdaySection, /player|p1/);
    assert.match(weekdaySection, /kyoryu/);
    assert.match(weekdaySection, /flat|groundY|terrain/i);
    assert.match(html, /drawWeekdayDungeonClouds\(\);[\s\S]{0,300}?drawUnit\(localUnit\(\)\)/,
      '中央キャラは雲の前景に描いて必ず視認できるようにしてください。');
  }],
  ['a release just outside the Battle cancel circle is canonicalized into the durable shot range', () => {
    const fnStart = html.indexOf('  function weekdayDungeonCanonicalShot(');
    const fnEnd = html.indexOf('  function weekdayDungeonLaunchDurableAttempt(', fnStart);
    assert.ok(fnStart >= 0 && fnEnd > fnStart, 'weekday canonical shot function must exist');
    const build = new Function('FIRE_MIN_DRAG', 'MAX_DRAG', 'weekdayDungeonBattle', 'weekdayDungeonApis',
      `${html.slice(fnStart, fnEnd)}\nreturn weekdayDungeonCanonicalShot;`);
    const canonicalize = build(12, 130, { snapshot: { apis: { domain: weekdayDomain } } }, () => ({ domain: weekdayDomain }));
    const shot = canonicalize(26.1, 0);
    const magnitude = Math.hypot(shot.dragX, shot.dragY);
    assert.ok(magnitude >= weekdayDomain.SHOT_LIMITS.minDrag);
    assert.ok(magnitude <= weekdayDomain.SHOT_LIMITS.maxDrag);
    assert.doesNotThrow(() => weekdayDomain.createAttempt({
      dayInfo: weekdayDomain.getDayInfo({ nowMs: Date.UTC(2026, 8, 5) }),
      shot,
    }));
  }],
  ['all six reward lanes are drawn under opaque Hamilton clouds and only the hit lane can reveal', () => {
    assert.match(html, /getZoneLayout\(/);
    assert.match(html, /hamulton-cream-cloud-frames\.png/);
    assert.match(html, /drawWeekdayDungeonTargets|weekdayDungeon.*Target/i);
    assert.match(html, /drawWeekdayDungeon(?:Challenge)?Clouds|weekdayDungeon.*Cloud/i);
    const cloudSection = sourceAfter('drawWeekdayDungeon');
    assert.match(cloudSection, /globalAlpha\s*=\s*alpha/);
    assert.match(cloudSection, /return 1/);
    assert.match(html, /reveal(?:ed|ing)?(?:Zone|Cloud)|hit.*reveal|reveal.*hit/i);
  }],
  ['one-shot protection isolates normal match, ONLINE, GOAL and suspend paths', () => {
    const checkMatch = sourceAfter('function checkMatchEnd(');
    assert.match(checkMatch.slice(0, 600), /weekdayDungeonBattleActive\(\).*return/);
    assert.match(html, /battleMode\s*!==\s*['"]weekday['"]/);
    const weekdaySection = sourceAfter('function weekdayDungeonBattleActive(');
    assert.match(weekdaySection, /isOnline|ONLINE|online/i);
    assert.match(weekdaySection, /saveSuspendedMatch|suspend/i);
    assert.match(weekdaySection, /戻る|GARAGE/);
  }],
  ['battle status is live-readable and reduced-motion stays immediate', () => {
    assert.match(html, /aria-live="(?:polite|assertive)"[^>]*id="weekdayDungeon(?:Battle)?Status"|id="weekdayDungeon(?:Battle)?Status"[^>]*aria-live="(?:polite|assertive)"/);
    assert.match(html, /prefers-reduced-motion:\s*reduce/);
    assert.match(html, /reducedMotion|prefersReducedMotion/);
  }],
  ['production integration has no test-only weekday controls', () => {
    assert.doesNotMatch(html, /KatamonWeekdayDungeonUi|setAimForTest|fireForTest|resetAnimationForTest/);
  }],
  ['offline cache retains the reused cloud but excludes the retired portrait background', () => {
    assert.match(sw, /hamulton-cream-cloud-frames\.png/);
    assert.doesNotMatch(sw, /weekday_dungeon_vault_01\.jpg/);
  }],
];

let passed = 0;
for (const [name, check] of checks) {
  try { check(); passed += 1; console.log(`  ok ${name}`); }
  catch (error) { console.error(`  NG ${name}`); throw error; }
}
console.log(`weekday-dungeon-ui: ${passed}/${checks.length} passed`);
