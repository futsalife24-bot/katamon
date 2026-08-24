(function attachCoopMvpBoss(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonCoopBoss = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCoopMvpBoss() {
  'use strict';

  const BOSS_ID = 'siege-fortress-01';
  const BOSS_NAME = '超大型要塞戦車';
  const BOSS_ASSET_PATH = 'assets/bosses/runtime/fortress-tank.webp';
  const BOSS_PHASE2_ASSET_PATH = 'assets/bosses/runtime/fortress-tank-phase2.webp';
  const PART_DURABILITY = Object.freeze({
    twinCannon: 0.8,
    mainCannon: 1,
    frontArmor: 1.4,
    missilePod: 0.9,
  });
  const PART_DEFS = Object.freeze({
    twinCannon: Object.freeze({ label: '連装砲', x: 0.2, y: 0.3, radius: 0.135, phase: 1, notification: 'TWIN CANNON DESTROYED' }),
    mainCannon: Object.freeze({ label: '主砲', x: 0.48, y: 0.18, radius: 0.19, phase: 1, notification: 'MAIN CANNON DESTROYED' }),
    frontArmor: Object.freeze({ label: '前面装甲', x: 0.13, y: 0.67, radius: 0.2, phase: 1, notification: 'FRONT ARMOR DESTROYED' }),
    missilePod: Object.freeze({ label: 'ミサイルポッド', x: 0.83, y: 0.31, radius: 0.15, phase: 2, notification: 'MISSILE POD DESTROYED' }),
  });
  const PART_ORDER = Object.freeze(['twinCannon', 'mainCannon', 'frontArmor', 'missilePod']);
  const BODY_HITBOX = Object.freeze({ x: 0.03, y: 0.24, width: 0.94, height: 0.73 });
  // 通常2vs2エンジンへ載せるライブ4vs1用の狙点。画像alphaではなく固定座標を
  // 正本にし、画像の読込成否や端末差で命中部位が変わらないようにする。
  const LIVE_HIT_SHAPES = Object.freeze([
    Object.freeze({ type: 'rect', x: 0.12, y: 0.43, width: 0.85, height: 0.54, partId: null }),
    ...PART_ORDER.map((partId) => Object.freeze({
      type: 'circle',
      x: PART_DEFS[partId].x,
      y: PART_DEFS[partId].y,
      radius: PART_DEFS[partId].radius,
      partId,
    })),
  ]);
  const LIVE_CORE_SHAPE = Object.freeze({ x: 0.64, y: 0.67, radius: 0.095 });
  const LIVE_HULL_DAMAGE_MULTIPLIER = 2 / 3;
  const LIVE_PART_BODY_SPILL = 0.4;
  const LIVE_PART_HP_RATIO = 0.06;
  const LIVE_DIFFICULTY_RULES = Object.freeze({
    normal: Object.freeze({ coreRounds: 2, coreMultiplier: 2 }),
    hard: Object.freeze({ coreRounds: 2, coreMultiplier: 1.75 }),
    extreme: Object.freeze({ coreRounds: 1, coreMultiplier: 1.5 }),
  });
  const STAGE_WIDTH = 1440;
  const STAGE_HEIGHT = 660;
  const TERRAIN_BOTTOM = 636;
  const COLUMN_WIDTH = 3;
  const COLUMN_COUNT = STAGE_WIDTH / COLUMN_WIDTH;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function finite(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function terrainTopAt(x) {
    if (x < 120) return 588;
    if (x < 255) return 520;
    if (x < 405) return 480;
    if (x < 555) return 540;
    if (x < 735) return 450;
    if (x < 810) return 586;
    return 560;
  }

  function createFortressStage() {
    const segments = [];
    const materialSegments = [];
    for (let column = 0; column < COLUMN_COUNT; column += 1) {
      const x = column * COLUMN_WIDTH;
      const top = terrainTopAt(x);
      segments.push([[top, TERRAIN_BOTTOM]]);
      materialSegments.push(x < 120 ? [[top, TERRAIN_BOTTOM, 'steel']] : []);
    }
    return {
      stageId: 'coop_fortress_stage_v1',
      title: '黒鉄要塞・迎撃線',
      random: false,
      stageWidth: STAGE_WIDTH,
      stageHeight: STAGE_HEIGHT,
      terrainBottom: TERRAIN_BOTTOM,
      columnWidth: COLUMN_WIDTH,
      segments,
      materialSegments,
      appearance: {
        themeKey: 'volcanic',
        terrainColor: '#3e3430',
        decorationsEnabled: true,
      },
      spawnMap: {
        p1: { seat: 'p1', x: 180, y: terrainTopAt(180) - 18 },
        e1: { seat: 'e1', x: 330, y: terrainTopAt(330) - 18 },
        s1: { seat: 's1', x: 480, y: terrainTopAt(480) - 18 },
        s2: { seat: 's2', x: 660, y: terrainTopAt(660) - 18 },
      },
      rescuePlatform: {
        x: 0,
        y: 588,
        width: 120,
        height: TERRAIN_BOTTOM - 588,
        material: 'steel',
        destructible: false,
      },
      boss: {
        id: BOSS_ID,
        name: BOSS_NAME,
        x: 840,
        y: 205,
        width: 570,
        height: 380,
        facing: 'left',
        movable: false,
      },
    };
  }

  function createBossState(options = {}) {
    const bodyHp = Math.max(1, finite(options.bodyHp, 5000));
    const partUnitHp = Math.max(1, finite(options.partUnitHp, 500));
    const parts = {};
    PART_ORDER.forEach((partId) => {
      const maxHp = partUnitHp * PART_DURABILITY[partId];
      parts[partId] = {
        id: partId,
        label: PART_DEFS[partId].label,
        hp: maxHp,
        maxHp,
        active: PART_DEFS[partId].phase === 1,
        destroyed: false,
      };
    });
    return {
      id: BOSS_ID,
      phase: 1,
      body: { hp: bodyHp, maxHp: bodyHp },
      parts,
    };
  }

  function partCenter(placement, partId) {
    const definition = PART_DEFS[partId];
    if (!definition) throw new Error('unknown boss part');
    return {
      x: finite(placement?.x, 0) + finite(placement?.width, 0) * definition.x,
      y: finite(placement?.y, 0) + finite(placement?.height, 0) * definition.y,
    };
  }

  function bodyRect(placement) {
    return {
      x: placement.x + placement.width * BODY_HITBOX.x,
      y: placement.y + placement.height * BODY_HITBOX.y,
      width: placement.width * BODY_HITBOX.width,
      height: placement.height * BODY_HITBOX.height,
    };
  }

  function distanceToRect(point, rect) {
    const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
    const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
    return Math.hypot(dx, dy);
  }

  function resolveImpactTarget(state, placement, impact, blastRadius = 0) {
    if (!state || !placement || !impact) return { kind: 'none' };
    const radius = Math.max(0, finite(blastRadius, 0));
    const scale = Math.min(finite(placement.width, 0), finite(placement.height, 0));
    const candidates = PART_ORDER.filter((partId) => {
      const part = state.parts?.[partId];
      if (!part?.active || part.destroyed) return false;
      const center = partCenter(placement, partId);
      const distance = Math.hypot(impact.x - center.x, impact.y - center.y);
      return distance <= radius + PART_DEFS[partId].radius * scale;
    }).map((partId) => {
      const center = partCenter(placement, partId);
      return { partId, distance: Math.hypot(impact.x - center.x, impact.y - center.y) };
    }).sort((left, right) => left.distance - right.distance || PART_ORDER.indexOf(left.partId) - PART_ORDER.indexOf(right.partId));
    if (candidates.length) return { kind: 'part', partId: candidates[0].partId };
    return distanceToRect(impact, bodyRect(placement)) <= radius ? { kind: 'body' } : { kind: 'none' };
  }

  function applyBossDamage(state, target, rawDamage) {
    const next = clone(state);
    const damage = Math.max(0, finite(rawDamage, 0));
    let bodyDamage = 0;
    let partDamage = 0;
    let notification = null;
    if (target?.kind === 'part' && next.parts?.[target.partId]?.active && !next.parts[target.partId].destroyed) {
      const part = next.parts[target.partId];
      partDamage = damage;
      part.hp = clamp(part.hp - damage, 0, part.maxHp);
      bodyDamage = damage * 0.4;
      if (part.hp === 0) {
        part.destroyed = true;
        notification = PART_DEFS[target.partId].notification;
      }
    } else if (target?.kind === 'body') {
      bodyDamage = damage;
    }
    next.body.hp = clamp(next.body.hp - bodyDamage, 0, next.body.maxHp);
    return { state: next, bodyDamage, partDamage, notification };
  }

  function liveRules(difficulty) {
    return LIVE_DIFFICULTY_RULES[difficulty] || LIVE_DIFFICULTY_RULES.normal;
  }

  function livePartMaxHp(bodyMaxHp, partId) {
    return Math.max(1, Math.round(Math.max(1, finite(bodyMaxHp, 1)) * LIVE_PART_HP_RATIO * PART_DURABILITY[partId]));
  }

  function createLiveState(options = {}) {
    const difficulty = LIVE_DIFFICULTY_RULES[options.difficulty] ? options.difficulty : 'normal';
    const bodyMaxHp = Math.max(1, finite(options.bodyMaxHp, 2200));
    const parts = {};
    for (const partId of PART_ORDER) {
      const maxHp = livePartMaxHp(bodyMaxHp, partId);
      parts[partId] = {
        hp: maxHp,
        maxHp,
        active: PART_DEFS[partId].phase === 1,
        destroyed: false,
      };
    }
    return {
      phase: 1,
      difficulty,
      round: 1,
      parts,
      core: { charge: 0, exposed: false, roundsRemaining: 0, trigger: null },
    };
  }

  function exposeLiveCore(state, trigger) {
    const next = clone(state);
    next.core = {
      charge: 0,
      exposed: true,
      roundsRemaining: liveRules(next.difficulty).coreRounds,
      trigger: trigger || 'parts',
    };
    return next;
  }

  function normalizedDistanceToShape(point, shape) {
    if (shape.type === 'circle') {
      return Math.max(0, Math.hypot(point.x - shape.x, point.y - shape.y) - shape.radius);
    }
    const dx = Math.max(shape.x - point.x, 0, point.x - (shape.x + shape.width));
    const dy = Math.max(shape.y - point.y, 0, point.y - (shape.y + shape.height));
    return Math.hypot(dx, dy);
  }

  function resolveLiveTarget(state, point, projectileRadius = 0) {
    if (!state || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return { kind: 'none' };
    const radius = Math.max(0, finite(projectileRadius, 0));
    if (state.core?.exposed
        && Math.hypot(point.x - LIVE_CORE_SHAPE.x, point.y - LIVE_CORE_SHAPE.y) <= LIVE_CORE_SHAPE.radius + radius) {
      return { kind: 'core' };
    }
    const candidates = LIVE_HIT_SHAPES.filter((shape) => {
      if (!shape.partId) return false;
      const part = state.parts?.[shape.partId];
      return part?.active && !part.destroyed && normalizedDistanceToShape(point, shape) <= radius;
    }).map((shape) => ({
      partId: shape.partId,
      distance: Math.hypot(point.x - shape.x, point.y - shape.y),
    })).sort((left, right) => left.distance - right.distance
      || PART_ORDER.indexOf(left.partId) - PART_ORDER.indexOf(right.partId));
    if (candidates.length) return { kind: 'part', partId: candidates[0].partId };
    return LIVE_HIT_SHAPES.some((shape) => normalizedDistanceToShape(point, shape) <= radius)
      ? { kind: 'hull' }
      : { kind: 'none' };
  }

  function applyLiveDamage(state, target, rawDamage) {
    let next = clone(state);
    const damage = Math.max(0, finite(rawDamage, 0));
    let bodyDamage = 0;
    let partDamage = 0;
    let notification = null;
    let coreOpened = false;
    let resolvedTarget = target?.kind || 'hull';
    if (target?.kind === 'part' && next.parts?.[target.partId]?.active && !next.parts[target.partId].destroyed) {
      const part = next.parts[target.partId];
      const beforeHp = part.hp;
      part.hp = clamp(part.hp - damage, 0, part.maxHp);
      partDamage = beforeHp - part.hp;
      bodyDamage = Math.round(damage * LIVE_PART_BODY_SPILL);
      if (part.hp === 0) {
        part.destroyed = true;
        notification = PART_DEFS[target.partId].notification;
      }
      if (!next.core.exposed && part.maxHp > 0) {
        const progress = partDamage / part.maxHp * 15;
        const destruction = beforeHp > 0 && part.hp === 0 ? 25 : 0;
        next.core.charge = Math.min(100, next.core.charge + progress + destruction);
        if (next.core.charge >= 100) {
          next = exposeLiveCore(next, 'parts');
          coreOpened = true;
        }
      }
    } else if (target?.kind === 'core' && next.core?.exposed) {
      bodyDamage = Math.round(damage * liveRules(next.difficulty).coreMultiplier);
    } else {
      resolvedTarget = 'hull';
      bodyDamage = Math.round(damage * LIVE_HULL_DAMAGE_MULTIPLIER);
    }
    return {
      state: next,
      target: resolvedTarget,
      partId: target?.kind === 'part' ? target.partId : null,
      bodyDamage,
      partDamage,
      notification,
      coreOpened,
      coreMultiplier: target?.kind === 'core' && state.core?.exposed ? liveRules(state.difficulty).coreMultiplier : 1,
    };
  }

  function activateLivePhase2(state) {
    let next = clone(state);
    next.phase = 2;
    next.round = Math.max(1, Math.round(finite(next.round, 1))) + 1;
    if (next.parts?.missilePod) next.parts.missilePod.active = true;
    // 変形直後は見た目だけで終わらせず、狙えるCOREを必ず開いて攻防を変える。
    next = exposeLiveCore(next, 'phase2');
    return next;
  }

  function advanceLiveBossRound(state) {
    const next = clone(state);
    next.round = Math.max(1, Math.round(finite(next.round, 1))) + 1;
    if (next.core?.exposed) {
      next.core.roundsRemaining = Math.max(0, Math.round(finite(next.core.roundsRemaining, 0)) - 1);
      if (next.core.roundsRemaining === 0) {
        next.core.exposed = false;
        next.core.trigger = null;
      }
    }
    return next;
  }

  function liveAttackProfile(state) {
    const phase2Missile = state?.phase === 2 && state.parts?.missilePod?.active
      && !state.parts.missilePod.destroyed;
    if (phase2Missile) {
      return {
        weapon: 'missile', anchorX: PART_DEFS.missilePod.x, anchorY: PART_DEFS.missilePod.y,
        radius: 12, blastMultiplier: 1.85, damageMultiplier: 1.12, accuracyMultiplier: 0.82,
        warningLabel: 'ミサイル斉射', warningRadius: 64,
      };
    }
    const intactCannons = ['twinCannon', 'mainCannon']
      .filter((partId) => state?.parts?.[partId]?.active && !state.parts[partId].destroyed).length;
    const damageMultiplier = intactCannons >= 2 ? 1 : intactCannons === 1 ? 0.86 : 0.72;
    const anchor = state?.parts?.twinCannon?.active && !state.parts.twinCannon.destroyed
      ? PART_DEFS.twinCannon
      : state?.parts?.mainCannon?.active && !state.parts.mainCannon.destroyed
        ? PART_DEFS.mainCannon
        : { x: 0.48, y: 0.42 };
    return {
      weapon: 'cannon', anchorX: anchor.x, anchorY: anchor.y,
      radius: intactCannons ? 10 : 8,
      blastMultiplier: intactCannons ? 1.6 : 1.25,
      damageMultiplier,
      accuracyMultiplier: intactCannons >= 2 ? 1 : 1.18,
      warningLabel: intactCannons ? '要塞砲撃' : '応急砲撃', warningRadius: intactCannons ? 52 : 44,
    };
  }

  function liveStateLooksSafe(value, options = {}) {
    const expectedDifficulty = LIVE_DIFFICULTY_RULES[options.difficulty] ? options.difficulty : 'normal';
    const bodyMaxHp = Math.max(1, finite(options.bodyMaxHp, 2200));
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || (value.phase !== 1 && value.phase !== 2) || value.difficulty !== expectedDifficulty
        || !Number.isInteger(value.round) || value.round < 1 || value.round > 100
        || !value.parts || typeof value.parts !== 'object' || Array.isArray(value.parts)) return false;
    for (const partId of PART_ORDER) {
      const part = value.parts[partId];
      const expectedMax = livePartMaxHp(bodyMaxHp, partId);
      const expectedActive = PART_DEFS[partId].phase <= value.phase;
      if (!part || typeof part !== 'object' || Array.isArray(part)
          || part.maxHp !== expectedMax || !Number.isFinite(part.hp) || part.hp < 0 || part.hp > part.maxHp
          || part.active !== expectedActive || part.destroyed !== (part.hp === 0)
          || (!part.active && (part.hp !== part.maxHp || part.destroyed))) return false;
    }
    const core = value.core;
    const coreLimit = liveRules(expectedDifficulty).coreRounds;
    if (!core || typeof core !== 'object' || Array.isArray(core)
        || !Number.isFinite(core.charge) || core.charge < 0 || core.charge > 100
        || typeof core.exposed !== 'boolean' || !Number.isInteger(core.roundsRemaining)
        || core.roundsRemaining < 0 || core.roundsRemaining > coreLimit
        || (core.exposed ? core.roundsRemaining < 1 : core.roundsRemaining !== 0)
        || ![null, 'parts', 'phase2', 'attack'].includes(core.trigger)
        || (core.exposed ? core.trigger == null : core.trigger != null)) return false;
    return true;
  }

  // Phase 2への変形そのものは、既存装甲のHPを回復・追加破壊しない。
  // 受信側がプレイヤー弾を再現し終えたphase1 stateをbeforeに渡し、変形で合法的に
  // 変わるphase/round/ミサイル/COREだけを限定して検証する。
  function livePhase2TransitionLooksSafe(before, after, options = {}) {
    if (!liveStateLooksSafe(before, options) || !liveStateLooksSafe(after, options)
        || before.phase !== 1 || after.phase !== 2 || after.difficulty !== before.difficulty
        || after.round !== before.round + 1) return false;
    for (const partId of PART_ORDER) {
      const previous = before.parts[partId];
      const next = after.parts[partId];
      if (next.maxHp !== previous.maxHp || next.hp !== previous.hp || next.destroyed !== previous.destroyed) return false;
      if (partId === 'missilePod') {
        if (previous.active || !next.active) return false;
      } else if (!previous.active || !next.active) return false;
    }
    const rules = liveRules(after.difficulty);
    return after.core.exposed === true
      && after.core.trigger === 'phase2'
      && after.core.charge === 0
      && after.core.roundsRemaining === rules.coreRounds;
  }

  function liveStateIsInitial(value, options = {}) {
    if (!liveStateLooksSafe(value, options) || value.phase !== 1 || value.round !== 1
        || value.core.exposed || value.core.charge !== 0 || value.core.roundsRemaining !== 0) return false;
    return PART_ORDER.every((partId) => value.parts[partId].hp === value.parts[partId].maxHp
      && value.parts[partId].destroyed === false);
  }

  function activatePhase2(state) {
    const next = clone(state);
    next.phase = 2;
    next.parts.missilePod.active = true;
    return next;
  }

  function carveTerrain(stage, impactX, radius) {
    const next = clone(stage);
    const center = finite(impactX, -9999);
    const craterRadius = Math.max(0, finite(radius, 0));
    if (!Array.isArray(next.segments) || craterRadius <= 0) return next;
    next.segments.forEach((segments, column) => {
      const x = column * next.columnWidth;
      const distance = Math.abs(x - center);
      if (distance > craterRadius || x < next.rescuePlatform.width || !segments?.[0]) return;
      const depth = Math.sqrt(Math.max(0, craterRadius * craterRadius - distance * distance)) * 0.72;
      segments[0][0] = clamp(segments[0][0] + depth, segments[0][0], next.terrainBottom);
    });
    return next;
  }

  function preloadBossAssets(browserRoot) {
    if (!browserRoot?.Image) return Promise.resolve({ phase1: null, phase2: null });
    const load = (src) => new Promise((resolve) => {
      const image = new browserRoot.Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = src;
    });
    return Promise.all([load(BOSS_ASSET_PATH), load(BOSS_PHASE2_ASSET_PATH)])
      .then(([phase1, phase2]) => ({ phase1, phase2 }));
  }

  function drawFallbackBoss(context, placement) {
    context.save();
    context.translate(placement.x, placement.y);
    const gradient = context.createLinearGradient(0, 0, 0, placement.height);
    gradient.addColorStop(0, '#59626a');
    gradient.addColorStop(0.5, '#1c272e');
    gradient.addColorStop(1, '#090d10');
    context.fillStyle = gradient;
    context.strokeStyle = '#bd7e32';
    context.lineWidth = 5;
    context.beginPath();
    if (context.roundRect) context.roundRect(0, placement.height * 0.35, placement.width, placement.height * 0.58, 24);
    else context.rect(0, placement.height * 0.35, placement.width, placement.height * 0.58);
    context.fill();
    context.stroke();
    context.fillStyle = '#0b0f12';
    context.fillRect(placement.width * 0.08, placement.height * 0.82, placement.width * 0.84, placement.height * 0.15);
    context.fillStyle = '#d27722';
    context.beginPath();
    context.arc(placement.width * 0.62, placement.height * 0.64, placement.height * 0.055, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function drawBoss(context, state, placement, assets) {
    if (!context || !placement) return false;
    const selected = state?.phase >= 2 ? assets?.phase2 : assets?.phase1;
    if (selected?.complete && selected.naturalWidth > 0) {
      context.drawImage(selected, placement.x, placement.y, placement.width, placement.height);
    } else {
      drawFallbackBoss(context, placement);
    }
    return true;
  }

  return Object.freeze({
    BOSS_ID,
    BOSS_NAME,
    BOSS_ASSET_PATH,
    BOSS_PHASE2_ASSET_PATH,
    PART_DURABILITY,
    PART_DEFS,
    PART_ORDER,
    BODY_HITBOX,
    LIVE_HIT_SHAPES,
    LIVE_CORE_SHAPE,
    LIVE_HULL_DAMAGE_MULTIPLIER,
    LIVE_PART_BODY_SPILL,
    LIVE_DIFFICULTY_RULES,
    createFortressStage,
    createBossState,
    partCenter,
    resolveImpactTarget,
    applyBossDamage,
    activatePhase2,
    createLiveState,
    resolveLiveTarget,
    applyLiveDamage,
    exposeLiveCore,
    activateLivePhase2,
    advanceLiveBossRound,
    liveAttackProfile,
    liveStateLooksSafe,
    liveStateIsInitial,
    livePhase2TransitionLooksSafe,
    carveTerrain,
    preloadBossAssets,
    drawBoss,
    terrainTopAt,
  });
});
