(function attachCoopBattle(root, factory) {
  const deps = typeof module === 'object' && module.exports ? {
    boss: require('./coop-mvp-boss.js'), ai: require('./coop-mvp-boss-ai.js'),
    engine: require('./coop-mvp-engine.js'), survival: require('./coop-mvp-survival.js'),
    items: require('./coop-mvp-items.js'), subweapons: require('./subweapon-mvp.js'),
    rewards: require('./coop-mvp-rewards.js'), session: require('./coop-mvp-session.js'),
  } : {
    boss: root?.KatamonCoopBoss, ai: root?.KatamonCoopBossAi, engine: root?.KatamonCoopEngine,
    survival: root?.KatamonCoopSurvival, items: root?.KatamonCoopItems,
    subweapons: root?.KatamonSubweapons, rewards: root?.KatamonCoopRewards,
    session: root?.KatamonCoopSession,
  };
  const api = factory(root, deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonCoopBattle = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCoopBattle(root, deps) {
  'use strict';

  const SEATS = Object.freeze(['p1', 'e1', 's1', 's2']);
  const AI_PLAYER_WEIGHT = 0.75;
  const DISCONNECT_DETECT_MS = 9000;
  const BATTLE_LIVENESS_GRACE_MS = 21000;
  const HOST_ABORT_AFTER_MS = 90000;
  const POLL_INTERVAL_MS = 700;
  const HEARTBEAT_INTERVAL_MS = 3000;
  const WORLD_WIDTH = 2160;
  const WORLD_HEIGHT = 960;
  const TERRAIN_COLUMNS = 720;
  const STEEL_GROUND_Y = 848;
  const STEEL_BOTTOM_Y = 936;
  const NORMAL_MESSAGE_PAGE_SIZE = 65;
  const NORMAL_RECENT_KEY_LIMIT = 256;
  // NORMALは部位→CORE→第二形態を8巡前後で見せ切れる耐久へ。難易度ごとの
  // 基礎値を分けているため、HARD／EXTREMEの耐久には影響しない。
  const BASE_BODY_HP = Object.freeze({ normal: 1650, hard: 2400, extreme: 2600 });
  const BASE_PART_HP = Object.freeze({ normal: 240, hard: 270, extreme: 300 });
  const BOSS_DAMAGE = Object.freeze({
    normal: Object.freeze({ grandCannon: 64, twinBarrage: 30, terrainBreaker: 34, missileBombardment: 40 }),
    hard: Object.freeze({ grandCannon: 76, twinBarrage: 36, terrainBreaker: 42, missileBombardment: 48 }),
    extreme: Object.freeze({ grandCannon: 88, twinBarrage: 42, terrainBreaker: 50, missileBombardment: 56 }),
  });
  const SPECIAL_BOSS_PROFILES = Object.freeze({
    kyoryu: Object.freeze({ damage: 45, terrainRadius: 72 }),
    medama: Object.freeze({ damage: 20, coreGain: 15, terrainRadius: 0 }),
    iwa: Object.freeze({ damage: 45, coreGain: 20, terrainRadius: 82 }),
    tori: Object.freeze({ damage: 63, terrainRadius: 48 }),
    barugerukan: Object.freeze({ damage: 30, terrainRadius: 34 }),
    nisenmono: Object.freeze({ damage: 45, terrainRadius: 38 }),
    burumutan: Object.freeze({ damage: 45, drainHeal: true, terrainRadius: 46 }),
    sumoeru: Object.freeze({ damage: 67, terrainRadius: 68 }),
    doRednote: Object.freeze({ damage: 24, terrainRadius: 44 }),
    hamulton: Object.freeze({ damage: 0, persistentCore: true, terrainRadius: 0 }),
    mocchario: Object.freeze({ damage: 45, terrainRadius: 76 }),
    mecha: Object.freeze({ damage: 135, terrainRadius: 52 }),
    akuma: Object.freeze({ damage: 45, terrainRadius: 0 }),
    jinba: Object.freeze({ damage: 135, terrainRadius: 88 }),
    kishi: Object.freeze({ damage: 45, selfCost: 15, terrainRadius: 70 }),
    neko: Object.freeze({ damage: 20, coreGain: 20, terrainRadius: 0 }),
    shinigami: Object.freeze({ damage: 0, terrainRadius: 110 }),
    coolKai: Object.freeze({ damage: 282, terrainRadius: 64 }),
  });
  let browserController = null;

  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }
  function safeNumber(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }

  function playerCountRatio(humans, aiPlayers) {
    const effective = clamp(safeNumber(humans) + safeNumber(aiPlayers) * AI_PLAYER_WEIGHT, 2, 4);
    if (effective <= 3) return 0.65 + (effective - 2) * 0.15;
    return 0.8 + (effective - 3) * 0.2;
  }

  function revisionPrefix(revision) {
    return clamp(Math.trunc(safeNumber(revision, 1)), 1, 0xffffffff).toString(16).padStart(8, '0');
  }

  function makeRoundId(revision, bytes) {
    const randomBytes = bytes || (() => {
      const output = new Uint8Array(20);
      if (!root?.crypto?.getRandomValues) throw new Error('secure random is unavailable');
      root.crypto.getRandomValues(output);
      return output;
    })();
    if (!randomBytes || randomBytes.length < 20) throw new Error('20 random bytes are required');
    return revisionPrefix(revision) + Array.from(randomBytes).slice(0, 20).map((value) => Number(value).toString(16).padStart(2, '0')).join('');
  }

  function hashSeed(text) {
    let value = 2166136261;
    for (const character of String(text || '')) {
      value ^= character.charCodeAt(0);
      value = Math.imul(value, 16777619);
    }
    return value >>> 0;
  }

  function seededRandom(seedText) {
    let state = hashSeed(seedText) || 1;
    return () => {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function windForRound(roundId, suffix = '') {
    const random = seededRandom(`${roundId}:${suffix}`);
    const direction = random() < 0.25 ? 0 : (random() < 0.5 ? -1 : 1);
    return { direction, strength: Math.round(random() * 10) };
  }

  function activeRoster(slots, aiFill, characters, aiCharacters = {}) {
    const available = Array.isArray(characters) && characters.length ? characters : [{ id: 'kyoryu', name: 'ディラノ', maxHp: 100, color: '#76d64b' }];
    const used = new Set(Object.values(slots || {}).map((slot) => slot?.character).filter(Boolean));
    const roster = {};
    SEATS.forEach((seat, index) => {
      const source = slots?.[seat];
      if (!source?.uid && aiFill !== true) return;
      let character = source?.character || aiCharacters?.[seat];
      if (!available.some((entry) => entry.id === character)) {
        character = available.find((entry) => !used.has(entry.id))?.id || available[index % available.length].id;
      }
      used.add(character);
      const definition = available.find((entry) => entry.id === character) || available[0];
      roster[seat] = {
        seat,
        uid: source?.uid || '',
        name: source?.name || `AI ${index + 1}`,
        ai: !source?.uid,
        character,
        characterName: definition.name,
        color: definition.color || '#e8c47a',
        maxHp: Math.max(1, safeNumber(definition.maxHp, 100)),
        assetPath: definition.assetPath || '',
        subweapon: source?.subweapon || null,
        coopItem: source?.coopItem || 'rescue-kit',
      };
    });
    return roster;
  }

  // ライブ通常戦エンジン向けの標的方針だけを純粋関数として共有する。
  // 配列の並びが席順であり、距離や端末固有の乱数には依存しない。
  function selectLiveBossTargetId(players, bossRound) {
    const alive = Array.isArray(players)
      ? players.filter((player) => player && typeof player.id === 'string' && Number(player.hp) > 0)
      : [];
    if (!alive.length) return null;
    const unguarded = alive.filter((player) => player.coopReviveGuard !== true);
    const pool = unguarded.length ? unguarded : alive;
    const round = Math.max(1, Math.min(100, Math.round(safeNumber(bossRound, 1))));
    return pool[(round - 1) % pool.length].id;
  }

  function shouldHoldRevivedTurn(player, bossRound) {
    const round = Math.max(1, Math.min(100, Math.round(safeNumber(bossRound, 1))));
    return !!player && player.coopReviveGuard === true
      && Math.round(safeNumber(player.coopRevivedBossRound, 0)) === round;
  }

  function createBattleState({ matchId, difficulty, slots, aiFill, characters, aiCharacters }) {
    const roster = activeRoster(slots, aiFill, characters, aiCharacters);
    const humanCount = Object.values(roster).filter((entry) => !entry.ai).length;
    const aiCount = Object.values(roster).filter((entry) => entry.ai).length;
    const ratio = playerCountRatio(humanCount, aiCount);
    const stage = deps.boss.createFortressStage();
    const partyInput = {};
    const subEquipment = {};
    Object.entries(roster).forEach(([seat, entry]) => {
      const spawn = stage.spawnMap[seat];
      partyInput[seat] = { maxHp: entry.maxHp, hp: entry.maxHp, x: spawn.x, y: spawn.y, coopItem: entry.coopItem };
      subEquipment[seat] = entry.subweapon;
    });
    const party = deps.survival.createParty(partyInput);
    Object.values(party.players).forEach((player) => { player.fuel = 100; player.specialGauge = 0; });
    return {
      matchId,
      difficulty: ['normal', 'hard', 'extreme'].includes(difficulty) ? difficulty : 'normal',
      roster,
      humanCount,
      aiCount,
      stage,
      encounter: deps.ai.createEncounter({
        difficulty,
        bodyHp: Math.round(BASE_BODY_HP[difficulty] * ratio),
        partUnitHp: Math.round(BASE_PART_HP[difficulty] * ratio),
      }),
      party,
      support: deps.items.createSupportState(),
      effects: { persistentCore: null },
      subweapons: deps.subweapons.createMatchState(subEquipment),
      round: 1,
      outcome: null,
      stats: { partsDestroyed: 0, rescues: {}, anyDown: false, deadLineWin: false },
      log: [],
    };
  }

  function bossAim(state) {
    const placement = state.stage.boss;
    const part = deps.boss.PART_ORDER.find((id) => state.encounter.boss.parts[id]?.active && !state.encounter.boss.parts[id].destroyed);
    return part ? deps.boss.partCenter(placement, part) : { x: placement.x + placement.width * 0.55, y: placement.y + placement.height * 0.62 };
  }

  function buildAiAction(state, seat, roundId, claimedPurposes = new Set()) {
    const player = state.party.players[seat];
    const equipped = state.roster[seat];
    let weapon = { kind: 'normal', id: 'normal' };
    let aim = bossAim(state);
    const downed = Object.values(state.party.players).find((entry) => entry.seat !== seat && entry.status === 'down');
    const low = Object.values(state.party.players).find((entry) => entry.seat !== seat && entry.status === 'alive' && entry.hp / entry.maxHp <= 0.3);
    if (downed && equipped.coopItem === 'rescue-kit' && player.itemUses.rescue > 0 && !claimedPurposes.has('rescue')) {
      weapon = { kind: 'coopItem', id: 'rescue-kit' }; aim = { x: downed.x, y: downed.y }; claimedPurposes.add('rescue');
    } else if (low && equipped.coopItem === 'healing-kit' && player.itemUses.healing > 0 && !claimedPurposes.has('healing')) {
      weapon = { kind: 'coopItem', id: 'healing-kit' }; aim = { x: low.x, y: low.y }; claimedPurposes.add('healing');
    } else if (state.encounter.core.exposed && equipped.coopItem === 'debuff-grenade' && player.itemUses.debuff > 0 && !claimedPurposes.has('debuff')) {
      weapon = { kind: 'coopItem', id: 'debuff-grenade' }; claimedPurposes.add('debuff');
    } else if (player.specialGauge >= 100) weapon = { kind: 'special', id: 'special' };
    const random = seededRandom(`${roundId}:${seat}:move`);
    const x = clamp(player.x + (random() - 0.5) * Math.min(70, player.fuel), 145, 760);
    return { x, fuelSpent: Math.min(player.fuel, Math.abs(x - player.x)), aim, weapon, committedAt: 0, auto: true };
  }

  function scheduleVolleyActions(actions, now) {
    const scheduled = {};
    SEATS.filter((seat) => actions?.[seat]).forEach((seat, index) => {
      const action = actions[seat];
      // committedAtはREADY(commit)専用。volleyのRules許可項目だけを明示して送る。
      scheduled[seat] = {
        x: action.x,
        fuelSpent: action.fuelSpent,
        aim: clone(action.aim),
        weapon: clone(action.weapon),
        scheduledAt: now + index * deps.engine.VOLLEY_INTERVAL_MS,
        auto: action.auto === true,
      };
    });
    return scheduled;
  }

  function closestFriendly(state, shooterSeat, aim, radius) {
    return Object.values(state.party.players).filter((player) => player.seat !== shooterSeat)
      .map((player) => ({ player, distance: Math.hypot(player.x - aim.x, player.y - aim.y) }))
      .filter((entry) => entry.distance <= radius).sort((a, b) => a.distance - b.distance)[0]?.player || null;
  }

  function applyDamageToPlayer(state, seat, damage, knockback = { x: 0, y: 0 }) {
    const barrier = deps.subweapons.applyIncomingDamage(state.subweapons, seat, damage);
    state.subweapons = barrier.state;
    const result = deps.survival.applyPlayerDamage(state.party, seat, { damage: barrier.damage, knockback });
    state.party = result.party;
    if (result.downedNow) state.stats.anyDown = true;
    return { hpDamage: result.hpDamage, blocked: barrier.blocked, downedNow: result.downedNow };
  }

  function addCoreCharge(state, amount) {
    if (state.encounter.core.exposed || amount <= 0) return;
    state.encounter.core.charge = clamp(state.encounter.core.charge + amount, 0, 100);
    if (state.encounter.core.charge >= 100) state.encounter = deps.ai.exposeCore(state.encounter, 'forced', state.round);
  }

  function tickPersistentCore(state) {
    const effect = state.effects?.persistentCore;
    if (!effect || effect.ticksRemaining <= 0) return;
    addCoreCharge(state, 5);
    effect.ticksRemaining -= 1;
    if (effect.ticksRemaining <= 0) state.effects.persistentCore = null;
  }

  function validatedWeapon(state, seat, requested) {
    const player = state.party.players[seat];
    const equipped = state.roster[seat];
    const kind = requested?.kind;
    const id = requested?.id;
    if (kind === 'special' && id === 'special' && safeNumber(player?.specialGauge) >= 100) return { kind, id };
    if (kind === 'subweapon' && equipped?.subweapon === id && deps.subweapons.SUBWEAPON_IDS.includes(id)) return { kind, id };
    if (kind === 'coopItem' && equipped?.coopItem === id && ['rescue-kit', 'healing-kit', 'debuff-grenade'].includes(id)) return { kind, id };
    return { kind: 'normal', id: 'normal' };
  }

  function applyPlayerAction(state, seat, action) {
    const next = clone(state);
    const player = next.party.players[seat];
    if (!player || !deps.survival.canAct(player, next.round)) return { state: next, event: { seat, kind: 'skip', label: 'DOWN' } };
    player.x = clamp(action?.x, 130, 790);
    player.fuel = clamp(player.fuel - clamp(action?.fuelSpent, 0, player.fuel), 0, 100);
    const weapon = validatedWeapon(next, seat, action?.weapon);
    const aim = { x: clamp(action?.aim?.x, 0, WORLD_WIDTH), y: clamp(action?.aim?.y, 0, WORLD_HEIGHT) };
    const specialProfile = SPECIAL_BOSS_PROFILES[next.roster[seat]?.character] || { damage: 45, terrainRadius: 58 };
    let rawDamage = weapon.kind === 'special' ? specialProfile.damage : 45;
    let label = weapon.kind === 'special' ? '必殺技' : '通常弾';
    let blastRadius = weapon.kind === 'special' ? specialProfile.terrainRadius : 42;
    let terrainRadius = blastRadius;
    let target = deps.boss.resolveImpactTarget(next.encounter.boss, next.stage.boss, aim, blastRadius);
    if (weapon.kind === 'special') player.specialGauge = 0;
    else player.specialGauge = clamp(safeNumber(player.specialGauge) + 25, 0, 100);

    if (weapon.kind === 'subweapon' && weapon.id === 'barrier') {
      const result = deps.subweapons.activateBarrier(next.subweapons, seat); next.subweapons = result.state;
      return { state: next, event: { seat, kind: 'barrier', label: result.activated ? 'BARRIER' : '使用不可', aim } };
    }
    if (weapon.kind === 'subweapon') {
      const result = deps.subweapons.fireProjectile(next.subweapons, seat, weapon.id); next.subweapons = result.state;
      if (!result.consumed) return { state: next, event: { seat, kind: 'skip', label: 'SUB使用不可', aim } };
      rawDamage = result.projectile.damage; label = weapon.id === 'impact' ? '衝撃弾' : '掘削弾';
      terrainRadius = Number.isFinite(result.projectile.terrainRadius) ? result.projectile.terrainRadius : 0;
      blastRadius = Math.max(32, terrainRadius);
      target = deps.boss.resolveImpactTarget(next.encounter.boss, next.stage.boss, aim, blastRadius);
    }
    if (weapon.kind === 'coopItem') {
      if (weapon.id === 'rescue-kit') {
        const result = deps.survival.fireRescueShot(next.party, seat, aim, next.round); next.party = result.party;
        if (result.rescuedSeat) next.stats.rescues[seat] = safeNumber(next.stats.rescues[seat]) + 1;
        return { state: next, event: { seat, kind: 'support', label: result.rescuedSeat ? `RESCUE ${result.rescuedSeat.toUpperCase()}` : '救助弾', aim } };
      }
      if (weapon.id === 'healing-kit') {
        const result = deps.items.fireHealingShot(next.party, seat, aim, next.round); next.party = result.party;
        return { state: next, event: { seat, kind: 'support', label: result.healedSeat ? `HEAL ${result.healedSeat.toUpperCase()}` : '回復弾', aim } };
      }
      const hitBoss = target.kind !== 'none';
      const result = deps.items.fireDebuffShot(next.party, next.support, seat, hitBoss, next.round);
      next.party = result.party; next.support = result.support;
      return { state: next, event: { seat, kind: 'debuff', label: result.applied ? 'WEAKENED' : '弱体化弾', aim } };
    }

    if (terrainRadius > 0) next.stage = deps.boss.carveTerrain(next.stage, aim.x, terrainRadius);

    const friendly = closestFriendly(next, seat, aim, weapon.kind === 'special' ? 64 : 48);
    if (friendly) {
      const effect = deps.engine.friendlyFireEffect({ damage: rawDamage, knockback: 32, terrainRadius: 44 });
      applyDamageToPlayer(next, friendly.seat, effect.damage, { x: friendly.x < aim.x ? -effect.knockback : effect.knockback, y: -10 });
    }
    let bodyDamage = 0;
    if (target.kind !== 'none') {
      const scaled = deps.items.scaleBossDamage(next.support, next.round, rawDamage);
      const beforeDestroyed = deps.boss.PART_ORDER.filter((id) => next.encounter.boss.parts[id].destroyed).length;
      const result = deps.ai.applyEncounterDamage(next.encounter, target, scaled);
      next.encounter = result.encounter; bodyDamage = result.bodyDamage;
      const afterDestroyed = deps.boss.PART_ORDER.filter((id) => next.encounter.boss.parts[id].destroyed).length;
      next.stats.partsDestroyed += Math.max(0, afterDestroyed - beforeDestroyed);
      if (weapon.kind === 'special') {
        addCoreCharge(next, specialProfile.coreGain || 0);
        if (specialProfile.persistentCore) {
          if (!next.effects.persistentCore) {
            addCoreCharge(next, 5);
            next.effects.persistentCore = { ticksRemaining: 2, source: seat };
          } else {
            next.effects.persistentCore.ticksRemaining = 3;
            next.effects.persistentCore.source = seat;
          }
        }
        if (specialProfile.drainHeal) player.hp = clamp(player.hp + result.bodyDamage + result.partDamage, 0, player.maxHp);
        if (specialProfile.selfCost) player.hp = Math.max(1, player.hp - specialProfile.selfCost);
      }
    }
    return { state: next, event: { seat, kind: weapon.kind, label, aim, target, bodyDamage } };
  }

  function attackTargets(state, attack, random) {
    const alive = deps.survival.normalBossTargets(state.party);
    const all = deps.survival.areaBossTargets(state.party);
    if (!alive.length && attack.targetMode !== 'area') return [];
    if (attack.targetMode === 'area' || attack.targetMode === 'terrain') return all;
    if (attack.targetMode === 'spread') {
      const start = Math.floor(random() * alive.length);
      return [alive[start], alive[(start + 1) % alive.length]].filter((seat, index, values) => values.indexOf(seat) === index);
    }
    return [alive[Math.floor(random() * alive.length)]];
  }

  function applyBossTurn(state, roundId) {
    let next = clone(state);
    const random = seededRandom(`${roundId}:boss`);
    const planned = deps.ai.planBossActions(next.encounter, random);
    next.encounter = planned.encounter;
    const events = [];
    for (const attack of planned.actions) {
      const targets = attackTargets(next, attack, random);
      const damage = BOSS_DAMAGE[next.difficulty][attack.id] || 30;
      targets.forEach((seat) => {
        const direction = next.party.players[seat].x < 700 ? -1 : 1;
        applyDamageToPlayer(next, seat, damage, { x: direction * (attack.targetMode === 'terrain' ? 55 : 24), y: -18 });
        if (attack.targetMode === 'terrain') next.stage = deps.boss.carveTerrain(next.stage, next.party.players[seat].x, 96);
      });
      events.push({ kind: 'boss', label: attack.label, attackId: attack.id, targets });
    }
    next.encounter = deps.ai.finishRound(next.encounter, planned.actions);
    next.round = next.encounter.round;
    next.party = deps.survival.startRound(next.party, next.round);
    next.support = deps.items.finishSupportRound(next.support, next.round - 1);
    return { state: next, events };
  }

  function resolveVolley(currentState, volley) {
    let state = clone(currentState);
    tickPersistentCore(state);
    const events = [];
    const actions = SEATS.map((seat) => volley?.actions?.[seat] ? { seat, ...volley.actions[seat] } : null).filter(Boolean);
    for (const action of actions) {
      const result = applyPlayerAction(state, action.seat, action);
      state = result.state; events.push(result.event);
    }
    if (state.encounter.boss.body.hp <= 0) state.outcome = 'victory';
    if (!state.outcome) {
      const phase = deps.ai.finishPlayerVolley(state.encounter);
      state.encounter = phase.encounter;
      if (phase.phaseTransitionPending) {
        state.encounter = deps.ai.completePhase2Transition(state.encounter);
        state.round = state.encounter.round;
        state.party = deps.survival.startRound(state.party, state.round);
        events.push({ kind: 'phase', label: 'PHASE 2' });
      } else {
        const bossTurn = applyBossTurn(state, volley.roundId);
        state = bossTurn.state; events.push(...bossTurn.events);
      }
    }
    if (!state.outcome && (deps.survival.isAllDownDefeat(state.party) || deps.ai.isRoundLimitDefeat(state.encounter))) state.outcome = 'defeat';
    state.log = [...state.log, ...events].slice(-24);
    return { state, events };
  }

  function extractVolleys(room, generationPrefix) {
    const rows = [];
    Object.entries(room?.rounds || {}).forEach(([roundId, value]) => {
      if (!roundId.startsWith(generationPrefix)) return;
      Object.values(value?.messages || {}).forEach((message) => {
        if (message?.t === 'volley' && message.roundId === roundId) rows.push(clone(message));
      });
    });
    return rows.sort((a, b) => safeNumber(a.sentAt) - safeNumber(b.sentAt) || String(a.roundId).localeCompare(String(b.roundId)));
  }

  function resultStats(state) {
    return {
      outcome: state.outcome || 'defeat',
      partsDestroyed: state.stats.partsDestroyed,
      totalParts: deps.boss.PART_ORDER.length,
      rescues: Object.values(state.stats.rescues).reduce((sum, value) => sum + safeNumber(value), 0),
      bossHpRemainingRatio: state.encounter.boss.body.hp / state.encounter.boss.body.maxHp,
      playerCount: state.humanCount,
      aiCount: state.aiCount,
      allPartsDestroyed: state.stats.partsDestroyed >= deps.boss.PART_ORDER.length,
      noDown: !state.stats.anyDown,
      deadLineWin: state.stats.deadLineWin,
    };
  }

  async function recordResultLocked(foundation, runtime, battleState, options) {
    if (!foundation?.mutateStateLocked) throw new Error('foundation state lock is unavailable');
    return foundation.mutateStateLocked((progressBefore) => {
      const preliminary = deps.session.resultSummary(runtime, {
        ...resultStats(battleState),
        firstClear: !progressBefore.boss.firstClears[battleState.difficulty],
      });
      const event = deps.session.rewardEvent(preliminary);
      const reward = event
        ? deps.rewards.recordEvent(progressBefore, event)
        : { state: progressBefore, duplicate: false, credited: 0, newlyCompleted: [] };
      const resultSummary = deps.session.resultSummary(runtime, {
        ...resultStats(battleState),
        coins: reward.credited,
        firstClear: preliminary.firstClear,
        achievements: reward.newlyCompleted,
      });
      return { state: reward.state, resultSummary, newlyCompleted: reward.newlyCompleted, duplicate: reward.duplicate === true };
    }, options);
  }

  function mountBrowser(browserRoot) {
    if (!browserRoot?.document?.body || browserRoot.document.getElementById('coopBattle')) return;
    const style = browserRoot.document.createElement('style');
    style.textContent = `
      #coopBattle{position:fixed;z-index:90;inset:0;display:none;pointer-events:none;font-family:var(--katamon-font-ui);color:#f7e8c5}#coopBattle.open{display:block}#coopBattle *{box-sizing:border-box}
      #coopWeapon{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
      .coop-battle-status{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
      .coop-result-actions{pointer-events:auto;position:absolute;left:50%;bottom:max(32px,5dvh);width:min(496px,calc(100vw - 20px));transform:translateX(-50%);display:none;grid-template-columns:1fr 1fr;gap:8px;padding:10px;border:2px solid #9f7137;background:#091115f2}.coop-result-actions.open{display:grid}.coop-result-actions button{min-height:48px;border:2px solid #c08a3e;background:#14232a;color:#ffe6ad;font-weight:900}.coop-result-actions .primary{background:#b77524;border-color:#ffcf63;color:#fff8dc}
    `;
    browserRoot.document.head.appendChild(style);
    const overlay = browserRoot.document.createElement('div'); overlay.id = 'coopBattle'; overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `<select id="coopWeapon" aria-label="武器選択"></select><div id="coopBattleStatus" class="coop-battle-status" aria-live="polite">出撃準備中…</div><section id="coopResultActions" class="coop-result-actions"><button id="coopReturnLobby" type="button">ロビーへ戻る</button><button id="coopVoteRematch" class="primary" type="button">再戦を希望</button></section>`;
    browserRoot.document.body.appendChild(overlay);
  }

  function createBrowserController(browserRoot, config) {
    const bridge = config.bridge;
    const sharedUi = bridge.getBattleUiContract?.() || {};
    const VIEW_W = sharedUi.width || 540;
    const VIEW_H = sharedUi.height || 960;
    const CONTROL_PANEL_Y = sharedUi.controlPanelY || 660;
    const controls = sharedUi.controls || {
      left: { x: 98, y: 874, r: 51 }, right: { x: 442, y: 874, r: 51 },
      fire: { x: 270, y: 810, r: 117 }, special: { x: 448, y: 726, r: 46 },
      subweapon: { x: 448, y: 805, r: 30 }, coopItem: { x: 92, y: 760, r: 34 },
    };
    const cameraSlider = sharedUi.cameraSlider || { x: 60, y: CONTROL_PANEL_Y + 31, w: 110 };
    const minCameraZoom = VIEW_W / WORLD_WIDTH;
    const maxCameraZoom = 1;
    const foundation = browserRoot.KatamonCoopMvp;
    const roomSession = config.session;
    const overlay = browserRoot.document.getElementById('coopBattle');
    const controlsEl = overlay;
    const statusEl = browserRoot.document.getElementById('coopBattleStatus');
    const weaponEl = browserRoot.document.getElementById('coopWeapon');
    const resultActionsEl = browserRoot.document.getElementById('coopResultActions');
    controlsEl.classList.remove('results'); resultActionsEl.classList.remove('open');
    let room = clone(roomSession.room);
    let generation = revisionPrefix(room.settings?.revision || 1);
    let state = createBattleState({ matchId: generation + '0'.repeat(40), difficulty: room.settings?.difficulty, slots: room.slots, aiFill: room.settings?.aiFill, characters: config.characters });
    let processed = new Set();
    let active = true;
    let pollTimer = 0;
    let heartbeatTimer = 0;
    let localRoundId = '';
    let localCommitted = false;
    let localDraft = null;
    let lastMoveSync = null;
    let aiDecisionRoundId = '';
    let aiDecisions = {};
    let advancingRoundId = '';
    let resultEntered = false;
    let resultEntryPromise = null;
    let resultOpenedAt = 0;
    let resultSummary = null;
    let rematchResolved = false;
    let shots = [];
    let notice = '';
    let noticeUntil = 0;
    let aimDrag = null;
    let moveHold = null;
    let inputMode = null;
    let inputPointerId = null;
    let panLastX = 0;
    let cameraX = 0;
    let cameraZoom = 1;
    let pinch = null;
    const touches = new Map();
    let introUntil = performance.now() + 2450;
    const bossAssetsPromise = deps.boss.preloadBossAssets(browserRoot);
    let bossAssets = {};
    bossAssetsPromise.then((value) => { bossAssets = value; });
    const background = new browserRoot.Image();
    background.decoding = 'async';
    background.src = 'assets/stage-volcanic-bg.jpg';

    function setStatus(message) { statusEl.textContent = message; }
    function ownPlayer() { return state.party.players[roomSession.seat]; }
    function ownRoster() { return state.roster[roomSession.seat]; }
    function serverNow() { return bridge.serverNow(roomSession.auth); }
    function isHost() { return roomSession.role === 'host'; }
    function currentRound() { return room?.round || null; }
    async function abortIfHostUnavailable() {
      if (isHost() || room.phase !== 'playing') return false;
      const hostSeenAt = safeNumber(room.slots?.p1?.seenAt, 0);
      if (!hostSeenAt || serverNow() - hostSeenAt <= HOST_ABORT_AFTER_MS) return false;
      setStatus('ホストとの接続を復旧できないため、無報酬でロビーへ戻ります');
      try {
        await bridge.request(`coopRooms/${roomSession.code}/phase`, roomSession.auth, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify('lobby'),
        });
        room.phase = 'lobby'; stop(room); return true;
      } catch (_) {
        setStatus('ホスト切断を確認中です。部屋の安全中断を再試行します'); return false;
      }
    }
    function ownCanInput() {
      const current = currentRound(); const player = ownPlayer();
      return active && performance.now() >= introUntil && room.phase === 'playing' && current?.status === 'input' && !localCommitted && deps.survival.canAct(player, state.round);
    }

    function populateWeapons() {
      const prior = weaponEl.value;
      weaponEl.textContent = '';
      const add = (value, label, disabled = false) => { const option = browserRoot.document.createElement('option'); option.value = value; option.textContent = label; option.disabled = disabled; weaponEl.appendChild(option); };
      add('normal:normal', '通常弾（白）');
      add('special:special', '必殺技（赤）', safeNumber(ownPlayer()?.specialGauge) < 100);
      if (ownRoster()?.subweapon) add(`subweapon:${ownRoster().subweapon}`, `SUB ${ownRoster().subweapon}（橙）`, !deps.subweapons.canUse(state.subweapons, roomSession.seat, ownRoster().subweapon));
      const item = ownRoster()?.coopItem || 'rescue-kit';
      const uses = ownPlayer()?.itemUses || {};
      const key = item === 'rescue-kit' ? 'rescue' : item === 'healing-kit' ? 'healing' : 'debuff';
      add(`coopItem:${item}`, `${item === 'rescue-kit' ? '救助弾' : item === 'healing-kit' ? '回復弾' : '弱体化弾'}（${uses[key] || 0}）`, (uses[key] || 0) <= 0);
      weaponEl.value = Array.from(weaponEl.options).some((option) => option.value === prior && !option.disabled) ? prior : 'normal:normal';
    }

    function resetDraft(roundId) {
      if (localRoundId === roundId) return;
      localRoundId = roundId; localCommitted = false;
      lastMoveSync = null;
      aiDecisionRoundId = ''; aiDecisions = {};
      const player = ownPlayer();
      localDraft = { x: player?.x || 180, fuelSpent: 0, aim: bossAim(state), weapon: { kind: 'normal', id: 'normal' } };
      populateWeapons();
      setStatus(performance.now() < introUntil ? '超大型要塞戦車 接近…' : player?.status === 'down' ? 'DOWN — 仲間の救助を待っています' : '中央の砲座を引いて離すとREADY');
    }

    function messagePath(roundId) { return `coopRooms/${roomSession.code}/rounds/${roundId}/messages/${bridge.pushId()}`; }
    async function sendMessage(message) {
      const sentAt = serverNow();
      const body = { v: 1, from: roomSession.auth.uid, seat: roomSession.seat, roundId: currentRound().id, sentAt, ...message };
      await bridge.request(messagePath(currentRound().id), roomSession.auth, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return body;
    }

    async function sendMove(final = false) {
      const finalAfterLock = final === true && active && room.phase === 'playing' && currentRound()?.status === 'input';
      if (!ownCanInput() && !finalAfterLock) return;
      const syncNow = performance.now();
      const [kind, id] = String(weaponEl.value || 'normal:normal').split(':');
      localDraft.weapon = { kind, id };
      const current = { x: localDraft.x, aim: clone(localDraft.aim), weaponKey: `${kind}:${id}` };
      if (!deps.engine.shouldSyncMove(lastMoveSync, current, syncNow, final === true)) return;
      lastMoveSync = { ...current, sentAt: syncNow };
      await sendMessage({
        t: 'move', x: localDraft.x, fuelSpent: localDraft.fuelSpent,
        aim: clone(localDraft.aim), weapon: clone(localDraft.weapon), final: final === true,
      }).catch(() => setStatus('入力同期を再試行します'));
    }

    async function commitLocal(aim) {
      if (!ownCanInput()) return;
      const [kind, id] = String(weaponEl.value || 'normal:normal').split(':');
      localDraft.aim = aim; localDraft.weapon = { kind, id };
      const action = { ...clone(localDraft), committedAt: serverNow(), auto: false };
      localCommitted = true; weaponEl.disabled = true;
      await sendMove(true);
      await sendMessage({ t: 'commit', action }).then(() => setStatus('READY — 仲間の照準確定を待っています')).catch(() => {
        localCommitted = false; weaponEl.disabled = false; setStatus('行動確定を送れませんでした。もう一度照準してください');
      });
    }

    function moveOwn(direction) {
      if (!ownCanInput()) return;
      const player = ownPlayer(); const amount = Math.min(24, Math.max(0, player.fuel - localDraft.fuelSpent));
      if (amount <= 0) { setStatus('移動燃料がありません'); return; }
      localDraft.x = clamp(localDraft.x + direction * amount, 130, 790); localDraft.fuelSpent += amount; sendMove(false);
    }

    function hitControl(point, control, pad = 8) {
      return Math.hypot(point.x - control.x, point.y - control.y) <= control.r + pad;
    }

    function updateAimFromDrag(point) {
      if (!aimDrag || !localDraft) return;
      aimDrag.current = point;
      const dx = aimDrag.origin.x - point.x;
      const dy = aimDrag.origin.y - point.y;
      const player = ownPlayer();
      localDraft.aim = {
        x: clamp(localDraft.x + dx * 6.4, 0, WORLD_WIDTH),
        y: clamp((player?.y || 450) + dy * 4.2, 40, WORLD_HEIGHT),
      };
      sendMove(false);
    }

    function collectRoundMessages(roundValue) {
      return Object.values(roundValue?.messages || {});
    }

    function committedActions(roundId) {
      const messages = collectRoundMessages(room.rounds?.[roundId]).filter((message) => message?.t === 'commit' && message.roundId === roundId)
        .sort((a, b) => safeNumber(a.sentAt) - safeNumber(b.sentAt));
      const actions = {};
      messages.forEach((message) => { if (!actions[message.seat] && state.roster[message.seat]?.uid === message.from) actions[message.seat] = clone(message.action); });
      return actions;
    }

    function latestMoves(roundId) {
      const moves = {};
      collectRoundMessages(room.rounds?.[roundId]).filter((message) => message?.t === 'move' && message.roundId === roundId)
        .sort((a, b) => safeNumber(a.sentAt) - safeNumber(b.sentAt)).forEach((message) => { moves[message.seat] = message; });
      return moves;
    }

    function prepareAiDecisions(roundId, actions, now, humansAreReady) {
      if (!humansAreReady && safeNumber(currentRound()?.deadlineAt) - now > deps.engine.AI_FINALIZE_WINDOW_MS) return {};
      if (aiDecisionRoundId === roundId) return clone(aiDecisions);
      const claimed = new Set(Object.values(actions).filter((action) => action?.weapon?.kind === 'coopItem')
        .map((action) => action.weapon.id === 'rescue-kit' ? 'rescue' : action.weapon.id === 'healing-kit' ? 'healing' : action.weapon.id === 'debuff-grenade' ? 'debuff' : '')
        .filter(Boolean));
      aiDecisionRoundId = roundId; aiDecisions = {};
      SEATS.filter((seat) => state.roster[seat]?.ai && deps.survival.canAct(state.party.players[seat], state.round))
        .forEach((seat) => { aiDecisions[seat] = buildAiAction(state, seat, roundId, claimed); });
      return clone(aiDecisions);
    }

    async function hostFinalizeIfReady() {
      if (!isHost() || room.phase !== 'playing' || currentRound()?.status !== 'input') return;
      const roundId = currentRound().id;
      const actions = committedActions(roundId); const moves = latestMoves(roundId); const now = serverNow();
      const humanSeats = Object.keys(state.roster).filter((seat) => !state.roster[seat].ai && deps.survival.canAct(state.party.players[seat], state.round));
      const connected = humanSeats.filter((seat) => now - safeNumber(room.slots?.[seat]?.seenAt, 0) <= DISCONNECT_DETECT_MS);
      const ready = connected.every((seat) => actions[seat]);
      const decidedAi = prepareAiDecisions(roundId, actions, now, ready);
      if (!ready && now < currentRound().deadlineAt) return;
      const claimed = new Set();
      SEATS.filter((seat) => state.roster[seat]).forEach((seat) => {
        if (actions[seat]) return;
        const player = state.party.players[seat];
        if (!deps.survival.canAct(player, state.round)) return;
        if (state.roster[seat].ai) actions[seat] = decidedAi[seat] || buildAiAction(state, seat, roundId, claimed);
        else if (!connected.includes(seat)) actions[seat] = buildAiAction(state, seat, roundId, claimed);
        else actions[seat] = {
          x: moves[seat]?.x ?? player.x, fuelSpent: moves[seat]?.fuelSpent || 0,
          aim: moves[seat]?.aim || bossAim(state), weapon: moves[seat]?.weapon || { kind: 'normal', id: 'normal' }, committedAt: now, auto: true,
        };
      });
      const scheduled = scheduleVolleyActions(actions, now);
      await bridge.request(`coopRooms/${roomSession.code}/round`, roomSession.auth, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...currentRound(), status: 'volley' }),
      });
      await sendMessage({ t: 'volley', actions: scheduled, wind: currentRound().wind });
    }

    function animateEvents(volley, events) {
      const now = performance.now();
      shots = SEATS.filter((seat) => volley.actions?.[seat]).map((seat, index) => ({
        seat, from: { x: state.party.players[seat]?.x || 180, y: state.party.players[seat]?.y || 450 },
        to: volley.actions[seat].aim, color: volley.actions[seat].weapon.kind === 'coopItem' ? '#66e5a2' : volley.actions[seat].weapon.kind === 'subweapon' ? '#f29a38' : volley.actions[seat].weapon.kind === 'special' ? '#ff6254' : '#ffffff',
        startsAt: now + index * 150, endsAt: now + index * 150 + 850,
      }));
      const final = events[events.length - 1]; notice = final?.label || ''; noticeUntil = now + 2200;
    }

    async function hostAdvanceAfter(volley) {
      if (!isHost() || advancingRoundId === volley.roundId) return;
      advancingRoundId = volley.roundId;
      await new Promise((resolve) => setTimeout(resolve, 2500));
      if (!active) return;
      if (state.outcome) {
        const now = serverNow();
        await bridge.request(`coopRooms/${roomSession.code}/round`, roomSession.auth, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: volley.roundId, status: 'results', deadlineAt: now + deps.session.REMATCH_WINDOW_MS, wind: currentRound().wind, nextWind: currentRound().nextWind }),
        });
        await bridge.request(`coopRooms/${roomSession.code}/phase`, roomSession.auth, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify('results') });
        return;
      }
      const nextId = makeRoundId(room.settings.revision);
      const nextRound = { id: nextId, status: 'input', deadlineAt: serverNow() + deps.engine.INPUT_TIME_MS, wind: currentRound().nextWind, nextWind: windForRound(nextId, 'next') };
      await bridge.request(`coopRooms/${roomSession.code}/round`, roomSession.auth, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nextRound) });
    }

    function replayVolleys() {
      const volleys = extractVolleys(room, generation);
      volleys.forEach((volley) => {
        if (processed.has(volley.roundId)) return;
        const current = volley.roundId === currentRound()?.id;
        const resolved = resolveVolley(state, volley); state = resolved.state; processed.add(volley.roundId);
        if (current) animateEvents(volley, resolved.events);
        populateWeapons();
        if (current) hostAdvanceAfter(volley).catch(() => setStatus('次ラウンドへの同期を再試行しています'));
      });
    }

    function cachedResultKey() { return `katamon.coopResult.${generation}`; }
    async function enterResult() {
      if (resultEntered) return resultEntryPromise;
      resultEntered = true; resultOpenedAt = safeNumber(currentRound()?.deadlineAt) - deps.session.REMATCH_WINDOW_MS;
      resultEntryPromise = (async () => {
        let cached = null;
        try { cached = JSON.parse(browserRoot.localStorage.getItem(cachedResultKey()) || 'null'); } catch (_) { cached = null; }
        if (cached?.matchId) resultSummary = cached;
        else {
          const runtime = deps.session.createRuntime({ id: generation + '0'.repeat(40), seats: room.slots, bossId: deps.boss.BOSS_ID, difficulty: state.difficulty, stageId: state.stage.stageId });
          const recorded = await recordResultLocked(foundation, runtime, state);
          let cachedAfterLock = null;
          try { cachedAfterLock = JSON.parse(browserRoot.localStorage.getItem(cachedResultKey()) || 'null'); } catch (_) { cachedAfterLock = null; }
          resultSummary = cachedAfterLock?.matchId ? cachedAfterLock : recorded.resultSummary;
          if (!cachedAfterLock?.matchId && !recorded.duplicate) {
            try { browserRoot.localStorage.setItem(cachedResultKey(), JSON.stringify(resultSummary)); } catch (_) { /* 保存不可でも試合は続ける */ }
          }
          if (recorded.newlyCompleted?.length) browserRoot.KatamonMvpShop?.notifyAchievements(recorded.newlyCompleted);
        }
        resultActionsEl.classList.add('open');
        controlsEl.classList.add('results');
        updateOwnReady(false).catch(() => {});
        setStatus('再戦受付 15秒');
        return resultSummary;
      })();
      try {
        return await resultEntryPromise;
      } catch (error) {
        resultEntered = false;
        resultEntryPromise = null;
        throw error;
      }
    }

    async function updateOwnReady(ready) {
      const prior = room.slots?.[roomSession.seat];
      if (!prior?.uid) return;
      const next = { ...prior, ready: ready === true, seenAt: { '.sv': 'timestamp' } };
      await bridge.request(`coopRooms/${roomSession.code}/slots/${roomSession.seat}`, roomSession.auth, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
      room.slots[roomSession.seat] = { ...prior, ready: ready === true, seenAt: serverNow() };
    }

    async function hostResolveRematch() {
      if (!isHost() || rematchResolved || room.phase !== 'results' || serverNow() < currentRound().deadlineAt) return;
      rematchResolved = true;
      const yesSeats = SEATS.filter((seat) => room.slots?.[seat]?.uid && room.slots[seat].ready === true && safeNumber(room.slots[seat].seenAt) >= resultOpenedAt);
      if (yesSeats.length >= 2 && yesSeats.includes('p1')) {
        for (const seat of SEATS.filter((seat) => seat !== 'p1' && room.slots?.[seat]?.uid && !yesSeats.includes(seat))) {
          await bridge.request(`coopRooms/${roomSession.code}/slots/${seat}`, roomSession.auth, { method: 'DELETE' }).catch(() => {});
        }
      }
      await bridge.request(`coopRooms/${roomSession.code}/phase`, roomSession.auth, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify('lobby') });
    }

    function stop(nextRoom) {
      if (!active) return;
      active = false; clearTimeout(pollTimer); clearTimeout(heartbeatTimer);
      if (moveHold?.timer) clearInterval(moveHold.timer);
      bridge.detachBattleSurface?.(battleSurface);
      overlay.classList.remove('open'); overlay.setAttribute('aria-hidden', 'true'); bridge.setBattleAudio(false);
      if (nextRoom) config.onReturnLobby?.(nextRoom);
    }

    async function syncRoom() {
      const latest = await bridge.request(`coopRooms/${roomSession.code}`, roomSession.auth);
      if (!latest || !latest.slots?.[roomSession.seat]?.uid) throw new Error('協力部屋から退出しました');
      room = latest; roomSession.room = latest;
      const nextGeneration = revisionPrefix(room.settings?.revision || 1);
      if (nextGeneration !== generation && room.phase === 'playing') {
        generation = nextGeneration; processed = new Set(); resultEntered = false; resultEntryPromise = null; resultSummary = null; rematchResolved = false;
        state = createBattleState({ matchId: generation + '0'.repeat(40), difficulty: room.settings?.difficulty, slots: room.slots, aiFill: room.settings?.aiFill, characters: config.characters, aiCharacters: room.settings?.aiCharacters });
      }
      if (await abortIfHostUnavailable()) return;
      replayVolleys();
      if (room.phase === 'lobby') { stop(room); return; }
      if (room.phase === 'results') { await enterResult(); await hostResolveRematch(); return; }
      if (currentRound()?.status === 'input') { resetDraft(currentRound().id); weaponEl.disabled = !ownCanInput(); await hostFinalizeIfReady(); }
      const seconds = Math.max(0, Math.ceil((safeNumber(currentRound()?.deadlineAt) - serverNow()) / 1000));
      if (!localCommitted && ownCanInput()) setStatus(`ROUND ${state.round}　入力残り ${seconds}秒`);
    }

    async function heartbeat() {
      if (!active || !room.slots?.[roomSession.seat]) return;
      await bridge.request(`coopRooms/${roomSession.code}/slots/${roomSession.seat}`, roomSession.auth, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seenAt: { '.sv': 'timestamp' } }) }).catch(() => {});
      if (active) heartbeatTimer = setTimeout(heartbeat, HEARTBEAT_INTERVAL_MS);
    }

    async function poll() {
      if (!active) return;
      try { await syncRoom(); }
      catch (error) { setStatus(error.message || '通信を再試行しています'); }
      if (active) pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    }

    function weaponMode() { return String(weaponEl.value || 'normal:normal').split(':'); }

    function surfaceUnit(seat) {
      const player = state.party.players[seat];
      const roster = state.roster[seat];
      if (!player || !roster) return null;
      return {
        id: seat,
        team: 'player',
        control: seat === roomSession.seat ? 'local' : 'remote',
        character: roster.character,
        label: `${roster.name}${roster.ai ? ' [AI]' : ''}`,
        color: roster.color,
        x: seat === roomSession.seat && localDraft ? localDraft.x : player.x,
        y: player.y,
        vy: 0,
        knockbackVx: 0,
        grounded: true,
        fallStartY: player.y,
        hp: player.hp,
        maxHp: player.maxHp,
        fuel: Math.max(0, player.fuel - (seat === roomSession.seat ? safeNumber(localDraft?.fuelSpent) : 0)),
        fuelMax: 100,
        specialCharge: player.specialGauge,
        moveLockTurns: 0,
        actionSkipTurns: player.status === 'down' ? 1 : 0,
        jumpAvailable: true,
        subweapon: roster.subweapon,
        subweaponUsesLeft: roster.subweapon && deps.subweapons.canUse(state.subweapons, seat, roster.subweapon) ? 1 : 0,
        subweaponBarrierActive: !!state.subweapons?.players?.[seat]?.barrierActive,
        facingLeft: false,
      };
    }

    function surfaceView() {
      const [weaponKind, weaponId] = weaponMode();
      const current = currentRound();
      const player = ownPlayer();
      const roster = ownRoster();
      const item = roster?.coopItem || 'rescue-kit';
      const itemKey = item === 'rescue-kit' ? 'rescue' : item === 'healing-kit' ? 'healing' : 'debuff';
      return {
        active,
        worldWidth: WORLD_WIDTH,
        worldHeight: WORLD_HEIGHT,
        cameraX,
        cameraZoom,
        units: SEATS.map(surfaceUnit).filter(Boolean),
        localSeat: roomSession.seat,
        canInput: ownCanInput(),
        committed: localCommitted,
        matchOver: !!state.outcome || room.phase === 'results',
        wind: current?.wind || { direction: 1, strength: 0 },
        nextWind: current?.nextWind || current?.wind || { direction: 1, strength: 0 },
        weaponKind,
        weaponId,
        aimState: aimDrag ? {
          owner: roomSession.seat,
          anchor: { x: localDraft?.x || player?.x || 180, y: (player?.y || 450) - 22 },
          origin: { ...aimDrag.origin },
          curX: aimDrag.current.x,
          curY: aimDrag.current.y,
        } : null,
        moveDirection: moveHold?.direction || 0,
        coopItem: item,
        coopItemUses: safeNumber(player?.itemUses?.[itemKey]),
        status: statusEl.textContent,
        round: state.round,
        boss: state.encounter.boss,
        stage: state.stage,
        bossName: deps.boss.BOSS_NAME,
        difficulty: state.difficulty,
        intro: Math.max(0, introUntil - performance.now()),
        notice: notice && performance.now() < noticeUntil ? notice : '',
        result: resultEntered ? resultSummary : null,
      };
    }

    function drawSurfaceWorld(target) {
      if (background.complete && background.naturalWidth) {
        target.drawImage(background, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      } else {
        const sky = target.createLinearGradient(0, 0, 0, WORLD_HEIGHT);
        sky.addColorStop(0, '#35151a'); sky.addColorStop(1, '#090b0e');
        target.fillStyle = sky; target.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      }
      const stage = state.stage;
      target.beginPath(); target.moveTo(0, stage.terrainBottom);
      for (let column = 0; column < stage.segments.length; column += 1) {
        target.lineTo(column * stage.columnWidth, stage.segments[column][0][0]);
      }
      target.lineTo(stage.stageWidth, stage.terrainBottom); target.closePath();
      const ground = target.createLinearGradient(0, 430, 0, stage.terrainBottom);
      ground.addColorStop(0, '#684538'); ground.addColorStop(0.16, '#46322d'); ground.addColorStop(1, '#151317');
      target.fillStyle = ground; target.fill();
      target.strokeStyle = '#d29a46'; target.lineWidth = 5; target.stroke();
      const platform = stage.rescuePlatform;
      target.fillStyle = '#303940'; target.fillRect(platform.x, platform.y, platform.width, platform.height);
      target.strokeStyle = '#efba5d'; target.lineWidth = 3; target.strokeRect(platform.x, platform.y, platform.width, platform.height);
      deps.boss.drawBoss(target, state.encounter.boss, state.stage.boss, bossAssets);
      const now = performance.now();
      shots = shots.filter((shot) => now < shot.endsAt + 150);
      shots.forEach((shot) => {
        const progress = clamp((now - shot.startsAt) / (shot.endsAt - shot.startsAt), 0, 1);
        if (progress <= 0 || progress >= 1) return;
        const x = shot.from.x + (shot.to.x - shot.from.x) * progress;
        const y = shot.from.y + (shot.to.y - shot.from.y) * progress - Math.sin(progress * Math.PI) * 150;
        target.save(); target.fillStyle = shot.color; target.shadowColor = shot.color; target.shadowBlur = 14;
        target.beginPath(); target.arc(x, y, 7, 0, Math.PI * 2); target.fill(); target.restore();
      });
    }

    function armWeapon(value) {
      if (!ownCanInput()) return;
      const option = Array.from(weaponEl.options).find((entry) => entry.value === value && !entry.disabled);
      if (!option) return;
      weaponEl.value = weaponEl.value === value ? 'normal:normal' : value;
      const [kind, id] = weaponMode(); localDraft.weapon = { kind, id }; sendMove(false);
    }

    function stopMoveHold(pointerId) {
      if (!moveHold || (pointerId !== undefined && moveHold.pointerId !== pointerId)) return;
      clearInterval(moveHold.timer); moveHold = null;
    }

    function clampCamera() {
      cameraZoom = clamp(cameraZoom, minCameraZoom, maxCameraZoom);
      cameraX = clamp(cameraX, 0, Math.max(0, WORLD_WIDTH - VIEW_W / cameraZoom));
    }

    function setCameraZoomFromPoint(point) {
      const ratio = clamp((point.x - cameraSlider.x) / cameraSlider.w, 0, 1);
      const focusX = cameraX + VIEW_W / cameraZoom / 2;
      cameraZoom = minCameraZoom + (maxCameraZoom - minCameraZoom) * ratio;
      cameraX = focusX - VIEW_W / cameraZoom / 2;
      clampCamera();
    }

    function beginPinch() {
      const activeTouches = [...touches.entries()].filter(([, point]) => point.y < CONTROL_PANEL_Y);
      if (activeTouches.length < 2) return false;
      const [aEntry, bEntry] = activeTouches.slice(-2);
      const a = aEntry[1]; const b = bEntry[1];
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      if (distance < 12) return false;
      const midpointX = (a.x + b.x) / 2;
      pinch = {
        ids: [aEntry[0], bEntry[0]],
        startDistance: distance,
        startZoom: cameraZoom,
        anchorWorldX: cameraX + midpointX / cameraZoom,
      };
      inputMode = 'pinch'; inputPointerId = null;
      return true;
    }

    const battleSurface = {
      active: true,
      getView: surfaceView,
      drawWorld: drawSurfaceWorld,
      pointerDown(point, event) {
        if (event.pointerType === 'touch') {
          touches.set(event.pointerId, point);
          if (beginPinch()) return true;
        }
        if (point.y >= cameraSlider.y - 18 && point.y <= cameraSlider.y + 18
            && point.x >= cameraSlider.x - 12 && point.x <= cameraSlider.x + cameraSlider.w + 12) {
          inputMode = 'cameraSlider'; inputPointerId = event.pointerId; setCameraZoomFromPoint(point); return true;
        }
        if (ownCanInput() && (hitControl(point, controls.left) || hitControl(point, controls.right))) {
          const direction = hitControl(point, controls.left) ? -1 : 1;
          moveOwn(direction); stopMoveHold();
          moveHold = { pointerId: event.pointerId, direction, timer: setInterval(() => moveOwn(direction), 135) };
          inputMode = direction < 0 ? 'moveL' : 'moveR'; inputPointerId = event.pointerId; return true;
        }
        if (ownCanInput() && hitControl(point, controls.special)) { armWeapon('special:special'); return true; }
        if (ownCanInput() && hitControl(point, controls.subweapon) && ownRoster()?.subweapon) { armWeapon(`subweapon:${ownRoster().subweapon}`); return true; }
        if (ownCanInput() && hitControl(point, controls.coopItem)) { armWeapon(`coopItem:${ownRoster()?.coopItem || 'rescue-kit'}`); return true; }
        if (ownCanInput() && hitControl(point, controls.fire)) {
          aimDrag = { pointerId: event.pointerId, origin: { x: controls.fire.x, y: controls.fire.y }, current: point };
          inputMode = 'aim'; inputPointerId = event.pointerId; updateAimFromDrag(point); return true;
        }
        if (point.y < CONTROL_PANEL_Y) {
          inputMode = 'pan'; inputPointerId = event.pointerId; panLastX = point.x; return true;
        }
        return true;
      },
      pointerMove(point, event) {
        if (event.pointerType === 'touch' && touches.has(event.pointerId)) touches.set(event.pointerId, point);
        if (pinch?.ids.includes(event.pointerId)) {
          const a = touches.get(pinch.ids[0]); const b = touches.get(pinch.ids[1]);
          if (a && b) {
            const distance = Math.max(12, Math.hypot(b.x - a.x, b.y - a.y));
            const midpointX = (a.x + b.x) / 2;
            cameraZoom = pinch.startZoom * distance / pinch.startDistance;
            cameraX = pinch.anchorWorldX - midpointX / cameraZoom; clampCamera();
          }
          return true;
        }
        if (event.pointerId !== inputPointerId) return true;
        if (inputMode === 'cameraSlider') setCameraZoomFromPoint(point);
        else if (inputMode === 'aim' && aimDrag) updateAimFromDrag(point);
        else if (inputMode === 'pan') {
          cameraX -= (point.x - panLastX) / cameraZoom; panLastX = point.x; clampCamera();
        }
        return true;
      },
      pointerUp(point, event) {
        if (event.pointerType === 'touch') touches.delete(event.pointerId);
        if (pinch?.ids.includes(event.pointerId)) {
          pinch = null; inputMode = null; inputPointerId = null; return true;
        }
        stopMoveHold(event.pointerId);
        if (aimDrag?.pointerId === event.pointerId) {
          updateAimFromDrag(point);
          const distance = Math.hypot(aimDrag.current.x - aimDrag.origin.x, aimDrag.current.y - aimDrag.origin.y);
          const aim = clone(localDraft.aim); aimDrag = null;
          if (distance >= 14) commitLocal(aim); else setStatus('砲座を大きく引いて離すとREADY');
        }
        inputMode = null; inputPointerId = null; return true;
      },
      pointerCancel(point, event) {
        touches.delete(event.pointerId); stopMoveHold(event.pointerId);
        if (aimDrag?.pointerId === event.pointerId) aimDrag = null;
        pinch = null; inputMode = null; inputPointerId = null; return true;
      },
    };
    browserRoot.document.getElementById('coopVoteRematch').onclick = () => updateOwnReady(true).then(() => {
      browserRoot.document.getElementById('coopVoteRematch').disabled = true; setStatus('再戦希望を送信しました');
    }).catch(() => setStatus('再戦希望を送れませんでした'));
    browserRoot.document.getElementById('coopReturnLobby').onclick = () => updateOwnReady(false).then(() => {
      setStatus('受付終了後にロビーへ戻ります');
    }).catch(() => setStatus('選択を送れませんでした'));

    overlay.classList.add('open'); overlay.setAttribute('aria-hidden', 'false'); bridge.setBattleAudio(true);
    resultActionsEl.classList.remove('open'); weaponEl.disabled = true; populateWeapons();
    clampCamera();
    bridge.attachBattleSurface?.(battleSurface);
    poll(); heartbeat();
    return { stop: () => stop(null), getState: () => clone(state) };
  }

  const NORMAL_PACKET_TYPES = new Set(['hello', 'join', 'start', 'ready', 'move', 'fire', 'state', 'result', 'bye', 'ping', 'takeover']);
  const NORMAL_ACTION_ID_RE = /^[0-9a-f]{48}$/;
  const NORMAL_SEAT_UNIT = Object.freeze({ p1: 'p1', e1: 'e1', s1: 'p2', s2: 'e2' });
  const NORMAL_TURN_ORDER = Object.freeze(['p1', 'e1', 'p2', 'e2', 'boss1']);

  function normalPacketUnitAllowed(packet, outer, roster, delegatedSeats = null) {
    if (!['move', 'fire', 'state', 'result'].includes(packet.t)) return true;
    if (!NORMAL_TURN_ORDER.includes(packet.unitId)) return false;
    const ownerSeat = SEATS.find(seat => NORMAL_SEAT_UNIT[seat] === packet.unitId);
    // takeover が記録された後は、元の参加者から遅れて届いた fire/state/result を
    // 再生しない。引継ぎ中の席は host だけが同じ unitId の権威を持つ。
    if (ownerSeat && delegatedSeats?.has(ownerSeat)) return outer.seat === 'p1';
    if (packet.unitId === NORMAL_SEAT_UNIT[outer.seat]) return true;
    if (outer.seat !== 'p1') return false;
    if (packet.unitId === 'boss1') return true;
    return !!ownerSeat && roster[ownerSeat]?.ai === true;
  }

  function normalWindLooksSafe(value) {
    return value && [-1, 0, 1].includes(Number(value.dir))
      && Number.isFinite(Number(value.strength)) && Number(value.strength) >= 0 && Number(value.strength) <= 1;
  }

  function normalSnapshotLooksSafe(snapshot, roster, config, requireTerrain) {
    if (!snapshot || snapshot.battleMode !== 'coop' || snapshot.matchFormat !== 'coop4v1') return false;
    if (Number(snapshot.stageW) !== WORLD_WIDTH || Number(snapshot.stageH) !== WORLD_HEIGHT) return false;
    if (!Array.isArray(snapshot.craters) || snapshot.craters.length !== 0) return false;
    if (!Array.isArray(snapshot.turnOrder) || snapshot.turnOrder.join(',') !== NORMAL_TURN_ORDER.join(',')) return false;
    if (!Number.isInteger(snapshot.activeIndex) || snapshot.activeIndex < 0 || snapshot.activeIndex >= NORMAL_TURN_ORDER.length) return false;
    const roundLimit = Number(deps.ai?.DIFFICULTY_RULES?.[config?.difficulty || 'normal']?.roundLimit) || 20;
    if (!Number.isInteger(snapshot.turnCount) || snapshot.turnCount < 0
        || snapshot.turnCount > NORMAL_TURN_ORDER.length * roundLimit) return false;
    if (!normalWindLooksSafe(snapshot.wind) || !normalWindLooksSafe(snapshot.nextWind)) return false;
    if (!Array.isArray(snapshot.units) || snapshot.units.length !== 5) return false;
    const ids = snapshot.units.map(unit => unit?.id).join(',');
    if (ids !== NORMAL_TURN_ORDER.join(',')) return false;
    if (requireTerrain) {
      if (snapshot.pattern !== 'coopSteel' || snapshot.terrainMaterial !== 'terrain') return false;
      if (!Array.isArray(snapshot.segments) || snapshot.segments.length !== TERRAIN_COLUMNS
        || !snapshot.segments.every(column => Array.isArray(column) && column.length >= 1 && column.length <= 4
          && column.every(segment => Array.isArray(segment) && segment.length === 2
            && Number.isFinite(Number(segment[0])) && Number.isFinite(Number(segment[1]))
            && Number(segment[0]) >= 0 && Number(segment[0]) < Number(segment[1])
            && Number(segment[1]) <= STEEL_BOTTOM_Y)
          && column.some(segment => Number(segment[0]) === STEEL_GROUND_Y && Number(segment[1]) === STEEL_BOTTOM_Y))) return false;
      if (!Array.isArray(snapshot.terrainMaterialSegments) || snapshot.terrainMaterialSegments.length !== TERRAIN_COLUMNS
        || !snapshot.terrainMaterialSegments.every((column, columnIndex) => Array.isArray(column)
          && column.length >= 1 && column.length <= snapshot.segments[columnIndex].length
          && column.every(material => Array.isArray(material) && material.length === 3
            && material[2] === 'steel'
            && snapshot.segments[columnIndex].some(segment => (
              Number(material[0]) === Number(segment[0]) && Number(material[1]) === Number(segment[1])
            )))
          && column.some(material => Number(material[0]) === STEEL_GROUND_Y
            && Number(material[1]) === STEEL_BOTTOM_Y && material[2] === 'steel'))) return false;
      let elevatedColumns = 0;
      let steelElevatedColumns = 0;
      let destructibleElevatedColumns = 0;
      for (let columnIndex = 0; columnIndex < snapshot.segments.length; columnIndex++) {
        const elevated = snapshot.segments[columnIndex].filter(segment => Number(segment[0]) < STEEL_GROUND_Y);
        if (!elevated.length) continue;
        elevatedColumns++;
        const materials = snapshot.terrainMaterialSegments[columnIndex];
        const hasSteelElevated = elevated.some(segment => materials.some(material => (
          material[2] === 'steel' && Number(material[0]) === Number(segment[0]) && Number(material[1]) === Number(segment[1])
        )));
        if (hasSteelElevated) steelElevatedColumns++;
        if (elevated.some(segment => !materials.some(material => (
          material[2] === 'steel' && Number(material[0]) === Number(segment[0]) && Number(material[1]) === Number(segment[1])
        )))) destructibleElevatedColumns++;
      }
      if (elevatedColumns < 140 || steelElevatedColumns < 70 || destructibleElevatedColumns < 30) return false;
    } else if (Object.hasOwn(snapshot, 'segments') || Object.hasOwn(snapshot, 'pattern') || Object.hasOwn(snapshot, 'terrainMaterialSegments')) return false;
    const seatByUnit = Object.fromEntries(Object.entries(NORMAL_SEAT_UNIT).map(([seat, unitId]) => [unitId, seat]));
    return snapshot.units.every(unit => {
      const hp = Number(unit?.hp); const maxHp = Number(unit?.maxHp);
      const x = Number(unit?.x); const y = Number(unit?.y);
      if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || hp < 0 || maxHp <= 0 || hp > maxHp) return false;
      if (!Number.isFinite(x) || x < 0 || x > WORLD_WIDTH || !Number.isFinite(y) || y < -100 || y > WORLD_HEIGHT) return false;
      if (!Number.isFinite(Number(unit.specialCharge)) || Number(unit.specialCharge) < 0 || Number(unit.specialCharge) > 100) return false;
      if (unit.id === 'boss1') {
        const liveStateOptions = { bodyMaxHp: maxHp, difficulty: config?.difficulty || 'normal' };
        const liveStateSafe = deps.boss?.liveStateLooksSafe?.(unit.bossState, liveStateOptions) === true;
        return unit.team === 'cpu' && unit.character == null && maxHp === Number(config?.bossMaxHp)
          && Number(unit.fuel) === 0 && Number(unit.fuelMax) === 0
          && unit.coopReviveGuard === false && Number(unit.coopRevivedBossRound) === 0
          && (unit.phase === 1 || unit.phase === 2)
          && liveStateSafe && unit.phase === unit.bossState.phase
          && (!requireTerrain || deps.boss?.liveStateIsInitial?.(unit.bossState, liveStateOptions) === true)
          && Number.isInteger(Number(unit.vulnerabilityTurns)) && Number(unit.vulnerabilityTurns) >= 0 && Number(unit.vulnerabilityTurns) <= 5;
      }
      const entry = roster?.[seatByUnit[unit.id]];
      const coopItem = entry?.coopItem || 'rescue-kit';
      const coopItemUseLimit = coopItem === 'healing-kit' ? 2 : 1;
      return !!entry && unit.team === 'player' && unit.character === entry.character && maxHp === Number(entry.maxHp)
        && Number.isFinite(Number(unit.fuel)) && Number.isFinite(Number(unit.fuelMax))
        && Number(unit.fuel) >= 0 && Number(unit.fuelMax) > 0 && Number(unit.fuel) <= Number(unit.fuelMax) && Number(unit.fuelMax) <= 256
        && (unit.subweapon || null) === (entry.subweapon || null)
        && Number.isInteger(Number(unit.subweaponUsesLeft)) && Number(unit.subweaponUsesLeft) >= 0 && Number(unit.subweaponUsesLeft) <= 1
        && (unit.coopItem || 'rescue-kit') === coopItem
        && Number.isInteger(Number(unit.coopItemUsesLeft)) && Number(unit.coopItemUsesLeft) >= 0
        && Number(unit.coopItemUsesLeft) <= coopItemUseLimit
        && typeof unit.coopReviveGuard === 'boolean'
        && Number.isInteger(Number(unit.coopRevivedBossRound))
        && Number(unit.coopRevivedBossRound) >= 0 && Number(unit.coopRevivedBossRound) <= 100
        && (unit.coopReviveGuard ? Number(unit.coopRevivedBossRound) >= 1 : Number(unit.coopRevivedBossRound) === 0);
    });
  }

  function normalPacketLooksSafe(packet, outer, roster, config, delegatedSeats = null) {
    if (!packet || packet.v !== 2 || packet.from !== outer.from || !NORMAL_PACKET_TYPES.has(packet.t)) return false;
    if (!Number.isInteger(packet.generation) || packet.generation < 1 || packet.generation > 100000) return false;
    if (packet.to != null && (typeof packet.to !== 'string' || !Object.values(roster).some(entry => entry?.uid === packet.to))) return false;
    if (!normalPacketUnitAllowed(packet, outer, roster, delegatedSeats)) return false;
    if (packet.t === 'start') return outer.seat === 'p1' && normalSnapshotLooksSafe(packet.snap, roster, config, true);
    if (packet.t === 'state') return NORMAL_ACTION_ID_RE.test(packet.actionId || '')
      && normalSnapshotLooksSafe(packet.snap, roster, config, false);
    if (packet.t === 'takeover') return outer.seat === 'p1' && SEATS.includes(packet.seat) && packet.seat !== 'p1' && typeof packet.value === 'boolean';
    if (packet.t === 'result') {
      if (!NORMAL_ACTION_ID_RE.test(packet.actionId || '') || typeof packet.reason !== 'string' || packet.reason.length > 80
        || !Array.isArray(packet.units) || packet.units.length !== NORMAL_TURN_ORDER.length
        || packet.units.map(unit => unit?.id).join(',') !== NORMAL_TURN_ORDER.join(',')) return false;
      const seatByUnit = Object.fromEntries(Object.entries(NORMAL_SEAT_UNIT).map(([seat, unitId]) => [unitId, seat]));
      if (!packet.units.every(unit => {
        const hp = unit?.hp;
        const maxHp = unit?.id === 'boss1' ? Number(config?.bossMaxHp) : Number(roster?.[seatByUnit[unit?.id]]?.maxHp);
        return Number.isFinite(hp) && Number.isFinite(maxHp) && hp >= 0 && hp <= maxHp;
      })) return false;
      const playerAlive = packet.units.some(unit => unit.id !== 'boss1' && unit.hp > 0);
      const bossAlive = packet.units.some(unit => unit.id === 'boss1' && unit.hp > 0);
      let expectedWinner = null;
      if (packet.reason === '時間切れ') {
        const playerHp = packet.units.filter(unit => unit.id !== 'boss1').reduce((sum, unit) => sum + unit.hp, 0);
        const playerMaxHp = SEATS.reduce((sum, seat) => sum + Number(roster?.[seat]?.maxHp || 0), 0);
        const bossHp = packet.units.find(unit => unit.id === 'boss1').hp;
        const playerRatio = playerMaxHp > 0 ? playerHp / playerMaxHp : 0;
        const bossRatio = Number(config?.bossMaxHp) > 0 ? bossHp / Number(config.bossMaxHp) : 0;
        expectedWinner = playerRatio > bossRatio ? 'player' : playerRatio < bossRatio ? 'cpu' : 'draw';
      } else {
        expectedWinner = playerAlive && !bossAlive ? 'player' : !playerAlive && bossAlive ? 'cpu'
          : !playerAlive && !bossAlive ? 'draw' : null;
      }
      return packet.winner === expectedWinner;
    }
    if (packet.t === 'move') return Number.isFinite(Number(packet.x)) && Number(packet.x) >= 0 && Number(packet.x) <= WORLD_WIDTH
      && Number.isFinite(Number(packet.fuel)) && Number(packet.fuel) >= 0 && Number(packet.fuel) <= 256;
    if (packet.t === 'fire') {
      const values = [packet.x, packet.y, packet.anchor?.x, packet.anchor?.y, packet.vx0, packet.vy0].map(Number);
      if (!NORMAL_ACTION_ID_RE.test(packet.actionId || '') || !values.every(Number.isFinite)
        || Math.abs(values[4]) > 5000 || Math.abs(values[5]) > 5000) return false;
      if (packet.coopItemId && !['rescue-kit', 'healing-kit', 'debuff-grenade'].includes(packet.coopItemId)) return false;
      if (packet.bossShot === true && packet.unitId !== 'boss1') return false;
    }
    return true;
  }

  function createNormalBattleTransport(browserRoot, config, roster) {
    const bridge = config.bridge;
    const session = config.session;
    const roundId = session.room?.round?.id;
    if (!roundId || !session.auth?.uid) return null;
    let closed = false;
    let handler = null;
    let pollTimer = 0;
    let heartbeatTimer = 0;
    let leaseTimer = 0;
    let roomTimer = 0;
    let sendChain = Promise.resolve();
    let sendPoisoned = false;
    let historyReady = false;
    let releaseHistoryReady = null;
    const historyReadyGate = new Promise(resolve => { releaseHistoryReady = resolve; });
    let historyCursor = null;
    let seatLivenessHandler = null;
    let hostAbortHandler = null;
    let pendingHostAbort = null;
    let abortReported = false;
    const seen = new Set();
    const recentKeys = [];
    const backlog = [];
    const pendingLiveness = [];
    const takeoverBySeat = {};
    const delegatedSeats = new Set();
    const transportStartedAt = bridge.serverNow(session.auth);
    let activeGeneration = 1;

    function rememberKey(key) {
      if (seen.has(key)) return false;
      seen.add(key);
      recentKeys.push(key);
      while (recentKeys.length > NORMAL_RECENT_KEY_LIMIT) seen.delete(recentKeys.shift());
      return true;
    }

    function outerLooksSafe(message) {
      const slot = session.room?.slots?.[message?.seat];
      return message?.v === 1 && message?.t === 'net' && message.roundId === roundId
        && SEATS.includes(message.seat) && typeof message.from === 'string'
        && slot?.uid === message.from && typeof message.payload === 'string' && message.payload.length <= 220000;
    }

    async function poll() {
      if (closed) return;
      try {
        for (let page = 0; page < 4 && !closed; page++) {
          const query = historyCursor
            ? { orderBy: '"$key"', startAt: JSON.stringify(historyCursor), limitToFirst: NORMAL_MESSAGE_PAGE_SIZE }
            : { orderBy: '"$key"', limitToLast: NORMAL_MESSAGE_PAGE_SIZE };
          const rows = await bridge.request(`coopRooms/${session.code}/rounds/${roundId}/messages`, session.auth, { query });
          const ordered = Object.entries(rows || {}).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
          // 再読込時に古いfire/stateを再生しない。現在位置だけ覚え、直後に送るjoin/helloで
          // ホストから現在の完全snapshotを取り直す。
          if (!historyReady) {
            const validPackets = [];
            for (const [key, outer] of ordered) {
              rememberKey(key);
              if (!outerLooksSafe(outer)) continue;
              let packet = null;
              try { packet = JSON.parse(outer.payload); } catch (_) { packet = null; }
              if (!normalPacketLooksSafe(packet, outer, roster, config, delegatedSeats)) continue;
              validPackets.push(packet);
              if (packet.t === 'start') activeGeneration = Math.max(activeGeneration, packet.generation);
            }
            delegatedSeats.clear();
            for (const packet of validPackets) {
              // 過去の砲撃は再生しないが、最新試合でhostが引き継いだ席の権限は復元する。
              if (packet.generation !== activeGeneration || packet.t !== 'takeover') continue;
              if (packet.value) delegatedSeats.add(packet.seat);
              else delegatedSeats.delete(packet.seat);
            }
            historyCursor = ordered.length ? String(ordered[ordered.length - 1][0]) : null;
            historyReady = true;
            releaseHistoryReady?.();
            releaseHistoryReady = null;
            break;
          }
          let advanced = false;
          for (const [key, outer] of ordered) {
            if (historyCursor && String(key).localeCompare(historyCursor) <= 0) continue;
            historyCursor = String(key);
            advanced = true;
            if (!rememberKey(key) || !outerLooksSafe(outer)) continue;
            let packet = null;
            try { packet = JSON.parse(outer.payload); } catch (_) { packet = null; }
            if (!normalPacketLooksSafe(packet, outer, roster, config, delegatedSeats)) continue;
            if (packet.t === 'start') {
              if (packet.generation < activeGeneration) continue;
              if (packet.generation > activeGeneration) {
                activeGeneration = packet.generation;
                delegatedSeats.clear();
              }
            } else if (packet.t !== 'hello' && packet.t !== 'join' && packet.generation !== activeGeneration) continue;
            if (packet.t === 'takeover') {
              if (packet.value) delegatedSeats.add(packet.seat);
              else delegatedSeats.delete(packet.seat);
            }
            if (handler) handler(packet);
            else {
              backlog.push(packet);
              if (backlog.length > NORMAL_RECENT_KEY_LIMIT) backlog.shift();
            }
          }
          if (!advanced || ordered.length < NORMAL_MESSAGE_PAGE_SIZE) break;
        }
      } catch (error) {
        browserRoot.console?.warn?.('CO-OP transport retry', error);
      }
      if (!closed) pollTimer = browserRoot.setTimeout(poll, 350);
    }

    function reportHostAbort(message) {
      if (abortReported) return;
      abortReported = true;
      if (hostAbortHandler) hostAbortHandler(message);
      else pendingHostAbort = message;
    }

    function reportSeatLiveness(seat, useAi) {
      const update = { seat, useAi: useAi === true };
      if (seatLivenessHandler) seatLivenessHandler(update.seat, update.useAi);
      else pendingLiveness.push(update);
    }

    async function pollRoomLiveness() {
      if (closed) return;
      // 初回messages GETがcursorを確立する前にtakeoverをPOSTすると、その1通が
      // 「過去履歴」として権限だけ復元され、画面側へ届かない。初期同期後に判定する。
      if (!historyReady) {
        roomTimer = browserRoot.setTimeout(pollRoomLiveness, POLL_INTERVAL_MS);
        return;
      }
      try {
        const [slotsValue, phase] = await Promise.all([
          bridge.request(`coopRooms/${session.code}/slots`, session.auth),
          bridge.request(`coopRooms/${session.code}/phase`, session.auth),
        ]);
        const slots = slotsValue && typeof slotsValue === 'object' ? slotsValue : {};
        session.room.slots = slots;
        session.room.phase = phase;
        const now = bridge.serverNow(session.auth);
        if (session.role === 'host') {
          for (const seat of SEATS) {
            const entry = roster[seat];
            if (seat === 'p1' || !entry || entry.ai || !entry.uid) continue;
            const current = slots[seat];
            const sameOccupant = !!current && current.uid === entry.uid;
            const withinStartGrace = sameOccupant && now < transportStartedAt + BATTLE_LIVENESS_GRACE_MS;
            // ロビーheartbeatは18秒間隔。出撃直後だけは古いseenAtを切断と誤認せず、
            // 戦闘heartbeatが一度届く猶予を置く。席消失・別UIDへの交代は即時に扱う。
            const stale = !sameOccupant || (!withinStartGrace && (!Number.isFinite(Number(current.seenAt))
              || Number(current.seenAt) < now - DISCONNECT_DETECT_MS));
            if (!Object.hasOwn(takeoverBySeat, seat)) {
              takeoverBySeat[seat] = stale;
              if (stale) reportSeatLiveness(seat, true);
            } else if (takeoverBySeat[seat] !== stale) {
              takeoverBySeat[seat] = stale;
              reportSeatLiveness(seat, stale);
            }
          }
        } else {
          const own = slots[session.seat];
          if (!own || own.uid !== session.auth.uid) reportHostAbort('協力部屋の自分の席を確認できませんでした。ロビーへ戻ります。');
          const host = slots.p1;
          if (!host || !Number.isFinite(Number(host.seenAt)) || Number(host.seenAt) < now - HOST_ABORT_AFTER_MS) {
            reportHostAbort('ホストとの接続が90秒以上確認できませんでした。ロビーへ戻ります。');
          } else if (phase !== 'playing' && phase !== 'results') {
            reportHostAbort('協力部屋が終了しました。ロビーへ戻ります。');
          }
        }
      } catch (error) {
        browserRoot.console?.warn?.('CO-OP room liveness retry', error);
      }
      if (!closed && !abortReported) roomTimer = browserRoot.setTimeout(pollRoomLiveness, HEARTBEAT_INTERVAL_MS);
    }

    async function heartbeat() {
      if (closed) return;
      await bridge.request(`coopRooms/${session.code}/slots/${session.seat}`, session.auth, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seenAt: { '.sv': 'timestamp' } }),
      }).catch(() => false);
      if (!closed) heartbeatTimer = browserRoot.setTimeout(heartbeat, HEARTBEAT_INTERVAL_MS);
    }

    async function renewLease() {
      if (closed || session.role !== 'host') return;
      const expiresAt = bridge.serverNow(session.auth) + 10 * 60 * 1000;
      await bridge.request(`coopRooms/${session.code}/expiresAt`, session.auth, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(expiresAt),
      }).catch(() => false);
      if (!closed) leaseTimer = browserRoot.setTimeout(renewLease, 45000);
    }

    poll();
    heartbeat();
    pollRoomLiveness();
    if (session.role === 'host') renewLease();
    return {
      send(packet) {
        if (closed || sendPoisoned || !packet || packet.v !== 2) return Promise.resolve(false);
        sendChain = sendChain.catch(() => false).then(async () => {
          // 初回cursor確立前にhello/joinを送ると、自分や相手の応答が初期履歴へ
          // 混ざって既読化される。送信開始を初期GET完了後へ揃える。
          await historyReadyGate;
          // 退出前に積んだbyeだけはclose後も送る。それ以外の古いstateは次画面へ持ち越さない。
          if (closed && packet.t !== 'bye') return false;
          const outer = {
            v: 1,
            t: 'net',
            from: session.auth.uid,
            seat: session.seat,
            roundId,
            sentAt: bridge.serverNow(session.auth),
            payload: JSON.stringify(packet),
          };
          if (outer.payload.length > 220000) throw new Error('協力戦の同期データが上限を超えました');
          try {
            // 複数端末の時計差でpush keyがcursorより過去へ潜るのを避けるため、
            // RTDB側に時系列keyを発番させる。messagesはappend-onlyルールのまま。
            await bridge.request(`coopRooms/${session.code}/rounds/${roundId}/messages`, session.auth, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(outer),
            });
            return true;
          } catch (error) {
            if (packet.t !== 'bye') sendPoisoned = true;
            const detail = error?.message || '';
            const message = /認証が切れました/.test(detail)
              ? '協力戦の通信が拒否されました。Firebaseルールが最新版か確認してください。'
              : '協力戦の同期に失敗しました。通信を確認してもう一度お試しください。';
            config.bridge.reportNormalBattleError?.(message);
            return false;
          }
        });
        return sendChain;
      },
      onMessage(fn) {
        handler = typeof fn === 'function' ? fn : null;
        while (handler && backlog.length) handler(backlog.shift());
      },
      onSeatLiveness(fn) {
        seatLivenessHandler = typeof fn === 'function' ? fn : null;
        while (seatLivenessHandler && pendingLiveness.length) {
          const update = pendingLiveness.shift();
          seatLivenessHandler(update.seat, update.useAi);
        }
      },
      onHostAbort(fn) {
        hostAbortHandler = typeof fn === 'function' ? fn : null;
        if (hostAbortHandler && pendingHostAbort) {
          const message = pendingHostAbort;
          pendingHostAbort = null;
          hostAbortHandler(message);
        }
      },
      close() {
        closed = true;
        releaseHistoryReady?.();
        releaseHistoryReady = null;
        browserRoot.clearTimeout(pollTimer);
        browserRoot.clearTimeout(heartbeatTimer);
        browserRoot.clearTimeout(leaseTimer);
        browserRoot.clearTimeout(roomTimer);
      },
    };
  }

  // 人間がホスト1人だけなら、戦闘の権威も入力も同じ端末に揃っている。
  // 不要なFirebase戦闘パケットを送らず、出先のソロ＋CPU3体確認を回線状態から切り離す。
  function createSoloNormalBattleTransport() {
    let closed = false;
    return {
      send(packet) { return Promise.resolve(!closed && !!packet); },
      onMessage() {},
      close() { closed = true; },
    };
  }

  async function returnNormalBattleToRoom(config) {
    const { bridge, session } = config;
    const own = session.room?.slots?.[session.seat];
    if (own?.uid) {
      await bridge.request(`coopRooms/${session.code}/slots/${session.seat}`, session.auth, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ready: false, seenAt: { '.sv': 'timestamp' } }),
      }).catch(() => false);
    }
    if (session.role === 'host') {
      await bridge.request(`coopRooms/${session.code}/phase`, session.auth, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify('lobby'),
      }).catch(() => false);
      const room = await bridge.request(`coopRooms/${session.code}`, session.auth).catch(() => null);
      config.onReturnLobby?.(room);
    } else {
      await bridge.request(`coopRooms/${session.code}/slots/${session.seat}`, session.auth, { method: 'DELETE' }).catch(() => false);
      config.onReturnLobby?.(null);
    }
  }

  async function exitNormalBattleToTitle(config) {
    const { bridge, session } = config;
    // メニューの「タイトルへ戻る」は作戦準備室を再表示しない。ホストは部屋全体、
    // 参加者は自分の席だけを片付け、通信不調でもローカル画面は先にタイトルへ戻す。
    if (session.role === 'host') {
      await bridge.request(`coopOpen/${session.code}`, session.auth, { method: 'DELETE' }).catch(() => false);
      await bridge.request(`coopRooms/${session.code}`, session.auth, { method: 'DELETE' }).catch(() => false);
    } else {
      await bridge.request(`coopRooms/${session.code}/slots/${session.seat}`, session.auth, { method: 'DELETE' }).catch(() => false);
    }
    config.onExitTitle?.();
    return true;
  }

  function startBrowser(config) {
    if (!root?.document || !config?.bridge?.startNormalBattle || !config?.session) return false;
    if (browserController) browserController.stop?.();
    const room = config.session.room || {};
    const roster = activeRoster(room.slots, room.settings?.aiFill, config.characters, room.settings?.aiCharacters);
    if (SEATS.some(seat => !roster[seat])) return false;
    const humans = Object.values(roster).filter(entry => !entry.ai).length;
    const aiPlayers = Object.values(roster).filter(entry => entry.ai).length;
    const difficulty = ['normal', 'hard', 'extreme'].includes(room.settings?.difficulty) ? room.settings.difficulty : 'normal';
    const soloHost = config.session.role === 'host' && humans === 1;
    const bossMaxHp = Math.round(BASE_BODY_HP[difficulty] * playerCountRatio(humans, aiPlayers));
    const transportConfig = { ...config, bossMaxHp };
    const transport = soloHost ? createSoloNormalBattleTransport() : createNormalBattleTransport(root, transportConfig, roster);
    if (!transport) return false;
    browserController = config.bridge.startNormalBattle({
      session: config.session,
      roster,
      difficulty,
      bossMaxHp,
      wind: room.round?.wind,
      nextWind: room.round?.nextWind,
      transport,
      async onResult() {
        const own = config.session.room?.slots?.[config.session.seat];
        if (!own?.uid) return false;
        const ownReady = config.bridge.request(`coopRooms/${config.session.code}/slots/${config.session.seat}`, config.session.auth, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ready: false, seenAt: { '.sv': 'timestamp' } }),
        }).catch(() => false);
        const phase = config.session.role === 'host'
          ? config.bridge.request(`coopRooms/${config.session.code}/phase`, config.session.auth, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify('results'),
          }).catch(() => false)
          : Promise.resolve(true);
        const [readyOk, phaseOk] = await Promise.all([ownReady, phase]);
        return readyOk !== false && phaseOk !== false;
      },
      onReturnLobby() {
        browserController = null;
        config.bridge.setBattleAudio(false);
        return returnNormalBattleToRoom(config);
      },
      onExitTitle() {
        browserController = null;
        config.bridge.setBattleAudio(false);
        return exitNormalBattleToTitle(config);
      },
    });
    if (!browserController) { transport.close(); return false; }
    config.bridge.setBattleAudio(true);
    return true;
  }

  return Object.freeze({
    AI_PLAYER_WEIGHT,
    WORLD_WIDTH,
    WORLD_HEIGHT,
    TERRAIN_COLUMNS,
    DISCONNECT_DETECT_MS,
    BATTLE_LIVENESS_GRACE_MS,
    HOST_ABORT_AFTER_MS,
    POLL_INTERVAL_MS,
    HEARTBEAT_INTERVAL_MS,
    BASE_BODY_HP,
    BASE_PART_HP,
    BOSS_DAMAGE,
    SPECIAL_BOSS_PROFILES,
    playerCountRatio,
    revisionPrefix,
    makeRoundId,
    seededRandom,
    windForRound,
    activeRoster,
    selectLiveBossTargetId,
    shouldHoldRevivedTurn,
    createBattleState,
    buildAiAction,
    scheduleVolleyActions,
    applyPlayerAction,
    applyBossTurn,
    resolveVolley,
    extractVolleys,
    resultStats,
    recordResultLocked,
    normalSnapshotLooksSafe,
    mountBrowser,
    startBrowser,
  });
});
