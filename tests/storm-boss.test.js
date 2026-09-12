const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const boss = require('../coop-storm-boss.js');
const fortress = require('../coop-mvp-boss.js');
const battle = require('../coop-mvp-battle.js');
const clone = value => JSON.parse(JSON.stringify(value));
let checks = 0;
function check(name, value) { assert.ok(value, name); checks++; }

for (const difficulty of ['normal', 'hard', 'extreme']) {
  const options = { bodyMaxHp: 2200, difficulty };
  let state = boss.createLiveState(options);
  check(`${difficulty}: starts with four organic parts and no core`, boss.liveStateIsInitial(state, options)
    && Object.keys(state.parts).length === 4 && !state.core.exposed);
  check('tank state is rejected', !boss.liveStateLooksSafe(fortress.createLiveState(options), options));
  check('storm state is rejected by tank', !fortress.liveStateLooksSafe(state, options));
  for (const id of boss.PART_ORDER) {
    const point = boss.PART_DEFS[id];
    check(`hit ${id}`, boss.resolveLiveTarget(state, point).partId === id);
  }
  check('transparent upper left is not a hit', boss.resolveLiveTarget(state, { x: 0, y: 0 }).kind === 'none');
  check('none cannot deal damage', boss.applyLiveDamage(state, { kind: 'none' }, 45).bodyDamage === 0);
  const rectPoint = { x: .42, y: .62 };
  check('hull is less armored than fortress', boss.applyLiveDamage(state, boss.resolveLiveTarget(state, rectPoint), 45).bodyDamage === 38);
  check('cycle starts with three shards', boss.liveAttackProfile(state).weapon === 'crystal' && boss.liveAttackProfile(state).shots === 3);
  let broken = boss.applyLiveDamage(state, { kind: 'part', partId: 'tailCrystal' }, 9999).state;
  check('tail break reduces barrage to one', boss.liveAttackProfile(broken).shots === 1);
  state = boss.advanceLiveBossRound(state);
  check('second turn charges without attack', boss.liveAttackProfile(state).weapon === 'charge' && boss.liveAttackProfile(state).damageMultiplier === 0);
  state = boss.advanceLiveBossRound(state);
  check('charge opens heart before lightning', state.core.exposed && boss.liveAttackProfile(state).weapon === 'lightning');
  check('three fixed dodgeable lanes', boss.liveAttackProfile(state).lanes.length === 3);
  const fullDamage = boss.liveAttackProfile(state).damageMultiplier;
  broken = boss.applyLiveDamage(state, { kind: 'part', partId: 'thunderHorn' }, 9999).state;
  check('horn destruction weakens lightning', boss.liveAttackProfile(broken).damageMultiplier < fullDamage);
  broken = boss.applyLiveDamage(state, { kind: 'part', partId: 'skyWing' }, 9999).state;
  check('wing destruction shrinks storm blast', boss.liveAttackProfile(broken).blastMultiplier < boss.liveAttackProfile(state).blastMultiplier);
  check('wing break exposes core for next complete party round', boss.advanceLiveBossRound(broken).core.exposed);
  check('heart is hittable at exact art location', boss.resolveLiveTarget(state, boss.LIVE_CORE_SHAPE).kind === 'core');
  check('heart damage rewards aim', boss.applyLiveDamage(state, { kind: 'core' }, 45).bodyDamage > 75);
  state = boss.advanceLiveBossRound(state);
  check('heart closes after lightning and cycle repeats', !state.core.exposed && boss.liveAttackProfile(state).weapon === 'crystal');
  const phase2 = boss.activateLivePhase2(broken);
  check('phase 2 preserves part destruction', phase2.parts.skyWing.destroyed && boss.livePhase2TransitionLooksSafe(broken, phase2, options));
  const forged = clone(phase2); forged.parts.thunderHorn.hp--;
  check('transition cannot smuggle part damage', !boss.livePhase2TransitionLooksSafe(broken, forged, options));
  phase2.round = 6;
  check('awakened storm has four lanes', boss.liveAttackProfile(phase2).lanes.length === 4);
  for (const mutate of [s => s.round = NaN, s => s.bossId = 'unknown', s => s.parts.skyWing.maxHp++,
    s => s.parts.skyWing.hp = -1, s => s.core.roundsRemaining = 50, s => s.parts.extra = {}]) {
    const invalid = clone(state); mutate(invalid);
    check('malformed state rejected', !boss.liveStateLooksSafe(invalid, options));
  }
}
check('dedicated platform positions differ from fortress', boss.PLATFORM_LAYOUT[0].top === .70 && boss.PLATFORM_LAYOUT[1].top === .55);
check('spawn platforms are protected; four cover platforms destructible', boss.PLATFORM_LAYOUT.filter(p => p.spawnSteel).length === 3
  && boss.PLATFORM_LAYOUT.filter(p => !p.spawnSteel).length === 4);
const repo = path.join(__dirname, '..');
const rules = JSON.parse(fs.readFileSync(path.join(repo, 'database.rules.json'), 'utf8')).rules;
for (const namespace of ['coopOpen', 'coopRooms', 'registeredCoopOpen', 'registeredCoopRooms']) {
  const schema = namespace.endsWith('Rooms') ? rules[namespace].$room.settings : rules[namespace].$room;
  check(`${namespace} allows only known boss IDs`, schema.bossId['.validate'].includes("=== 'storm-dragon-02'")
    && schema.bossId['.validate'].includes("=== 'siege-fortress-01'") && schema.$other['.validate'] === false);
}
for (const file of [boss.BOSS_ASSET_PATH, boss.STAGE_ASSET_PATH]) {
  check(`runtime asset exists: ${file}`, fs.statSync(path.join(repo, file)).size > 10000);
  check(`PWA caches asset: ${file}`, fs.readFileSync(path.join(repo, 'sw.js'), 'utf8').includes(`'./${file}'`));
}
check('solo entry point available', typeof battle.startSoloBrowser === 'function');
console.log(`Storm boss: ${checks}/${checks} passed`);
