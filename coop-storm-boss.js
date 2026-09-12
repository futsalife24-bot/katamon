(function attachStormBoss(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonStormBoss = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStormBoss() {
  'use strict';
  const BOSS_ID = 'storm-dragon-02';
  const BOSS_NAME = '雷晶龍ヴォルテリス';
  const BOSS_ASSET_PATH = 'assets/bosses/runtime/volteris.webp';
  const STAGE_ASSET_PATH = 'assets/stages/runtime/thunder-altar.webp';
  const PART_DEFS = Object.freeze({
    thunderHorn: Object.freeze({ label: '雷角', x: .165, y: .31, radius: .10, notification: '雷角破壊！ 落雷が弱体化' }),
    skyWing: Object.freeze({ label: '天翼晶', x: .33, y: .075, radius: .09, notification: '天翼晶破壊！ 暴風が弱体化' }),
    galeWing: Object.freeze({ label: '嵐翼晶', x: .65, y: .18, radius: .10, notification: '嵐翼晶破壊！ 暴風が弱体化' }),
    tailCrystal: Object.freeze({ label: '尾晶', x: .93, y: .66, radius: .115, notification: '尾晶破壊！ 結晶弾が単発化' }),
  });
  const PART_ORDER = Object.freeze(Object.keys(PART_DEFS));
  const LIVE_CORE_SHAPE = Object.freeze({ x: .25, y: .64, radius: .105 });
  const LIVE_HIT_SHAPES = Object.freeze([
    { type: 'rect', x: .16, y: .41, width: .45, height: .35 },
    { type: 'rect', x: .38, y: .27, width: .46, height: .20 },
    ...PART_ORDER.map(partId => Object.freeze({ type: 'circle', ...PART_DEFS[partId], partId })),
  ]);
  const PLATFORM_LAYOUT = Object.freeze([
    { start: .07, end: .18, top: .70, thickness: .045, phase: .3, spawnSteel: true },
    { start: .24, end: .35, top: .55, thickness: .04, phase: 1.1, spawnSteel: true },
    { start: .41, end: .51, top: .68, thickness: .045, phase: 2.1, spawnSteel: true },
    { start: .54, end: .65, top: .44, thickness: .04, phase: 2.8, spawnSteel: false },
    { start: .19, end: .29, top: .31, thickness: .032, phase: 3.2, spawnSteel: false },
    { start: .37, end: .47, top: .24, thickness: .032, phase: 4.2, spawnSteel: false },
    { start: .59, end: .68, top: .73, thickness: .03, phase: 4.9, spawnSteel: false },
  ].map(Object.freeze));
  const clone = value => JSON.parse(JSON.stringify(value));
  const difficultyOf = value => ['normal', 'hard', 'extreme'].includes(value) ? value : 'normal';
  const partMax = (hp, id) => Math.max(1, Math.round(hp * (id === 'thunderHorn' ? .085 : .065)));
  const coreMultiplier = difficulty => difficulty === 'extreme' ? 1.8 : difficulty === 'hard' ? 2 : 2.3;
  function createLiveState({ bodyMaxHp = 2200, difficulty = 'normal' } = {}) {
    return {
      bossId: BOSS_ID, phase: 1, difficulty: difficultyOf(difficulty), round: 1,
      parts: Object.fromEntries(PART_ORDER.map(id => {
        const maxHp = partMax(bodyMaxHp, id);
        return [id, { hp: maxHp, maxHp, active: true, destroyed: false }];
      })),
      core: { charge: 0, exposed: false, roundsRemaining: 0, trigger: null },
    };
  }
  function exposeLiveCore(state, trigger = 'attack') {
    const next = clone(state);
    next.core = { charge: 0, exposed: true, roundsRemaining: trigger === 'parts' ? 2 : 1, trigger };
    return next;
  }
  function resolveLiveTarget(state, point, radius = 0) {
    if (!state || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return { kind: 'none' };
    // x is normalized to width; circle radii are normalized to height (sprite is 3:2).
    const distance = shape => Math.hypot((point.x - shape.x) * 1.5, point.y - shape.y);
    if (state.core.exposed && distance(LIVE_CORE_SHAPE) <= LIVE_CORE_SHAPE.radius + radius) return { kind: 'core' };
    const partId = PART_ORDER.filter(id => !state.parts[id].destroyed && distance(PART_DEFS[id]) <= PART_DEFS[id].radius + radius)
      .sort((a, b) => distance(PART_DEFS[a]) - distance(PART_DEFS[b]))[0];
    if (partId) return { kind: 'part', partId };
    const hull = LIVE_HIT_SHAPES.some(shape => shape.type === 'circle'
      ? distance(shape) <= shape.radius + radius
      : Math.hypot(Math.max(shape.x - point.x, 0, point.x - shape.x - shape.width) * 1.5,
        Math.max(shape.y - point.y, 0, point.y - shape.y - shape.height)) <= radius);
    return { kind: hull ? 'hull' : 'none' };
  }
  function applyLiveDamage(state, target, rawDamage) {
    let next = clone(state);
    const damage = Number.isFinite(rawDamage) ? Math.max(0, rawDamage) : 0;
    let bodyDamage = 0, partDamage = 0, notification = null, coreOpened = false;
    let kind = target?.kind || 'none';
    const part = next.parts[target?.partId];
    if (kind === 'part' && part && !part.destroyed) {
      partDamage = Math.min(part.hp, damage);
      part.hp -= partDamage;
      bodyDamage = Math.round(damage * .55);
      if (part.hp === 0) {
        part.destroyed = true;
        notification = PART_DEFS[target.partId].notification;
        // Either wing breaks the electrical shield for one complete party round.
        if (target.partId === 'skyWing' || target.partId === 'galeWing') {
          next = exposeLiveCore(next, 'parts'); coreOpened = true;
        }
      }
    } else if (kind === 'core' && next.core.exposed) {
      bodyDamage = Math.round(damage * coreMultiplier(next.difficulty));
    } else if (kind !== 'none') {
      kind = 'hull'; bodyDamage = Math.round(damage * .85);
    }
    return { state: next, target: kind, partId: target?.partId || null, bodyDamage, partDamage,
      notification, coreOpened, coreMultiplier: kind === 'core' ? coreMultiplier(next.difficulty) : 1 };
  }
  function activateLivePhase2(state) {
    const next = exposeLiveCore(state, 'phase2');
    next.phase = 2; next.round += 1;
    return next;
  }
  function advanceLiveBossRound(state) {
    const next = clone(state);
    next.round += 1;
    if (next.core.exposed && --next.core.roundsRemaining <= 0) {
      next.core = { charge: 0, exposed: false, roundsRemaining: 0, trigger: null };
    }
    // After the charging turn, every ally gets a chance to hit the exposed heart.
    return state.round % 3 === 2 ? exposeLiveCore(next, 'attack') : next;
  }
  function liveAttackProfile(state) {
    const cycle = (state.round - 1) % 3;
    const wings = ['skyWing', 'galeWing'].filter(id => !state.parts[id].destroyed).length;
    const base = { anchorX: .17, anchorY: .42, radius: 9, accuracyMultiplier: .7,
      blastMultiplier: 1.15, damageMultiplier: .65, warningRadius: 54 };
    if (cycle === 1) return { ...base, weapon: 'charge', damageMultiplier: 0,
      warningLabel: '蓄雷 → 次の巡回で心核露出', warningRadius: 0 };
    if (cycle === 2) return { ...base, weapon: 'lightning',
      damageMultiplier: (state.parts.thunderHorn.destroyed ? .5 : .9) * (1 + wings * .12),
      blastMultiplier: 1.15 + wings * .18, radius: 10,
      lanes: state.phase === 2 ? [.13, .29, .45, .60] : [.13, .29, .45],
      warningLabel: state.phase === 2 ? '天雷崩し・四連雷' : '天雷崩し・三連雷', warningRadius: 62 };
    return { ...base, weapon: 'crystal', shots: state.parts.tailCrystal.destroyed ? 1 : 3,
      warningLabel: state.parts.tailCrystal.destroyed ? '残晶弾' : '尾晶・扇状三連弾' };
  }
  function liveStateLooksSafe(value, { bodyMaxHp = 2200, difficulty = 'normal' } = {}) {
    if (!value || value.bossId !== BOSS_ID || ![1, 2].includes(value.phase)
      || value.difficulty !== difficultyOf(difficulty) || !Number.isInteger(value.round)
      || value.round < 1 || value.round > 100 || !value.parts || Array.isArray(value.parts)
      || Object.keys(value.parts).length !== PART_ORDER.length) return false;
    for (const id of PART_ORDER) {
      const part = value.parts[id];
      if (!part || part.maxHp !== partMax(bodyMaxHp, id) || !Number.isFinite(part.hp)
        || part.hp < 0 || part.hp > part.maxHp || part.active !== true || part.destroyed !== (part.hp === 0)) return false;
    }
    const core = value.core;
    return !!core && core.charge === 0 && typeof core.exposed === 'boolean'
      && (core.exposed ? Number.isInteger(core.roundsRemaining) && core.roundsRemaining >= 1
        && core.roundsRemaining <= (core.trigger === 'parts' ? 2 : 1) : core.roundsRemaining === 0)
      && (core.exposed ? ['parts', 'phase2', 'attack'].includes(core.trigger) : core.trigger === null);
  }
  function liveStateIsInitial(value, options) {
    return liveStateLooksSafe(value, options) && value.phase === 1 && value.round === 1
      && !value.core.exposed && PART_ORDER.every(id => value.parts[id].hp === value.parts[id].maxHp);
  }
  function livePhase2TransitionLooksSafe(before, after, options) {
    if (!liveStateLooksSafe(before, options) || !liveStateLooksSafe(after, options)
      || before.phase !== 1 || after.phase !== 2) return false;
    const expected = activateLivePhase2(before);
    return after.round === expected.round && after.core.exposed && after.core.trigger === 'phase2'
      && PART_ORDER.every(id => after.parts[id].hp === before.parts[id].hp);
  }
  return Object.freeze({ BOSS_ID, BOSS_NAME, BOSS_ASSET_PATH, STAGE_ASSET_PATH, PLATFORM_LAYOUT,
    BOSS_PHASE2_ASSET_PATH: BOSS_ASSET_PATH, PART_DEFS, PART_ORDER, LIVE_CORE_SHAPE, LIVE_HIT_SHAPES,
    createLiveState, exposeLiveCore, resolveLiveTarget, applyLiveDamage, activateLivePhase2,
    advanceLiveBossRound, liveAttackProfile, liveStateLooksSafe, liveStateIsInitial, livePhase2TransitionLooksSafe });
});
