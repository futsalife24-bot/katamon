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
  const HOST_ABORT_AFTER_MS = 90000;
  const POLL_INTERVAL_MS = 700;
  const HEARTBEAT_INTERVAL_MS = 3000;
  const WORLD_SCALE_X = 0.5;
  const WORLD_SCALE_Y = 0.72;
  const WORLD_TOP = 50;
  const BASE_BODY_HP = Object.freeze({ normal: 2200, hard: 2400, extreme: 2600 });
  const BASE_PART_HP = Object.freeze({ normal: 240, hard: 270, extreme: 300 });
  const BOSS_DAMAGE = Object.freeze({
    normal: Object.freeze({ grandCannon: 64, twinBarrage: 30, terrainBreaker: 34, missileBombardment: 40 }),
    hard: Object.freeze({ grandCannon: 76, twinBarrage: 36, terrainBreaker: 42, missileBombardment: 48 }),
    extreme: Object.freeze({ grandCannon: 88, twinBarrage: 42, terrainBreaker: 50, missileBombardment: 56 }),
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

  function activeRoster(slots, aiFill, characters) {
    const available = Array.isArray(characters) && characters.length ? characters : [{ id: 'kyoryu', name: 'ディラノ', maxHp: 100, color: '#76d64b' }];
    const used = new Set(Object.values(slots || {}).map((slot) => slot?.character).filter(Boolean));
    const roster = {};
    SEATS.forEach((seat, index) => {
      const source = slots?.[seat];
      if (!source?.uid && aiFill !== true) return;
      let character = source?.character;
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

  function createBattleState({ matchId, difficulty, slots, aiFill, characters }) {
    const roster = activeRoster(slots, aiFill, characters);
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
    const player = state.party.players[seat];
    if (player) player.specialGauge = clamp(safeNumber(player.specialGauge) + (result.hpDamage > 0 ? 30 : 0), 0, 100);
    return { hpDamage: result.hpDamage, blocked: barrier.blocked, downedNow: result.downedNow };
  }

  function applyPlayerAction(state, seat, action) {
    const next = clone(state);
    const player = next.party.players[seat];
    if (!player || !deps.survival.canAct(player, next.round)) return { state: next, event: { seat, kind: 'skip', label: 'DOWN' } };
    player.x = clamp(action?.x, 130, 790);
    player.fuel = clamp(player.fuel - clamp(action?.fuelSpent, 0, player.fuel), 0, 100);
    const weapon = action?.weapon || { kind: 'normal', id: 'normal' };
    const aim = { x: clamp(action?.aim?.x, 0, 1440), y: clamp(action?.aim?.y, 0, 660) };
    let rawDamage = weapon.kind === 'special' ? 78 : 45;
    let label = weapon.kind === 'special' ? '必殺技' : '通常弾';
    let target = deps.boss.resolveImpactTarget(next.encounter.boss, next.stage.boss, aim, weapon.kind === 'special' ? 58 : 42);

    if (weapon.kind === 'subweapon' && weapon.id === 'barrier') {
      const result = deps.subweapons.activateBarrier(next.subweapons, seat); next.subweapons = result.state;
      return { state: next, event: { seat, kind: 'barrier', label: result.activated ? 'BARRIER' : '使用不可', aim } };
    }
    if (weapon.kind === 'subweapon') {
      const result = deps.subweapons.fireProjectile(next.subweapons, seat, weapon.id); next.subweapons = result.state;
      if (!result.consumed) return { state: next, event: { seat, kind: 'skip', label: 'SUB使用不可', aim } };
      rawDamage = result.projectile.damage; label = weapon.id === 'impact' ? '衝撃弾' : '掘削弾';
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
      player.specialGauge = clamp(safeNumber(player.specialGauge) + 26, 0, 100);
      if (weapon.kind === 'special') {
        player.specialGauge = 0;
        if (!next.encounter.core.exposed) {
          next.encounter.core.charge = clamp(next.encounter.core.charge + 10, 0, 100);
          if (next.encounter.core.charge >= 100) next.encounter = deps.ai.exposeCore(next.encounter, 'forced', next.round);
        }
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

  function mountBrowser(browserRoot) {
    if (!browserRoot?.document?.body || browserRoot.document.getElementById('coopBattle')) return;
    const style = browserRoot.document.createElement('style');
    style.textContent = `
      #coopBattle{position:fixed;z-index:90;inset:0;display:none;align-items:center;justify-content:center;background:#03070a;font-family:var(--katamon-font-ui);color:#f7e8c5;touch-action:none}#coopBattle.open{display:flex}#coopBattle *{box-sizing:border-box}
      .coop-battle-shell{position:relative;width:min(720px,100vw);height:min(960px,100dvh);overflow:hidden;background:#071014;border-inline:2px solid #9b672d;box-shadow:0 0 45px #000}
      #coopBattleCanvas{display:block;width:100%;height:100%;background:#060b0e;touch-action:none}.coop-battle-controls{position:absolute;left:10px;right:10px;bottom:10px;min-height:206px;padding:10px;border:2px solid #9f7137;background:linear-gradient(160deg,#243238f2,#091115f5 55%,#05090bf7);clip-path:polygon(12px 0,calc(100% - 12px) 0,100% 12px,100% calc(100% - 12px),calc(100% - 12px) 100%,12px 100%,0 calc(100% - 12px),0 12px);box-shadow:inset 0 0 0 2px #34454a,0 7px 20px #000}
      .coop-battle-row{display:grid;grid-template-columns:88px 1fr 88px;gap:8px;margin-bottom:8px}.coop-battle-row button,.coop-battle-row select,.coop-result-actions button{min-height:44px;border:1px solid #c08a3e;background:#14232a;color:#ffe6ad;font-weight:900}.coop-battle-row select{width:100%;padding:0 8px}.coop-aim-note{text-align:center;color:#d4c29b;font-size:12px;line-height:1.45}.coop-battle-status{min-height:32px;padding:6px;border-top:1px solid #5e472d;text-align:center;color:#ffd66d;font-size:12px;font-weight:900}.coop-result-actions{display:none;grid-template-columns:1fr 1fr;gap:8px}.coop-result-actions.open{display:grid}.coop-result-actions .primary{background:#b77524;border-color:#ffcf63;color:#fff8dc}.coop-battle-controls.results{min-height:0}.coop-battle-controls.results .coop-battle-row,.coop-battle-controls.results .coop-aim-note{display:none}
      @media(max-width:480px){.coop-battle-controls{left:6px;right:6px;bottom:6px;min-height:198px;padding:8px}.coop-battle-row{grid-template-columns:70px 1fr 70px;gap:5px}.coop-battle-row button,.coop-battle-row select,.coop-result-actions button{font-size:11px}.coop-aim-note,.coop-battle-status{font-size:10px}}
    `;
    browserRoot.document.head.appendChild(style);
    const overlay = browserRoot.document.createElement('div'); overlay.id = 'coopBattle'; overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `<div class="coop-battle-shell"><canvas id="coopBattleCanvas" width="720" height="960" aria-label="協力ボス戦場"></canvas><section id="coopBattleControls" class="coop-battle-controls"><div class="coop-battle-row"><button id="coopMoveLeft" type="button">◀ 移動</button><select id="coopWeapon" aria-label="武器選択"></select><button id="coopMoveRight" type="button">移動 ▶</button></div><div class="coop-aim-note">戦場をドラッグして照準。指を離した瞬間にこのラウンドの行動が確定します。</div><div id="coopBattleStatus" class="coop-battle-status">出撃準備中…</div><div id="coopResultActions" class="coop-result-actions"><button id="coopReturnLobby" type="button">ロビーへ戻る</button><button id="coopVoteRematch" class="primary" type="button">再戦を希望</button></div></section></div>`;
    browserRoot.document.body.appendChild(overlay);
  }

  function createBrowserController(browserRoot, config) {
    const bridge = config.bridge;
    const foundation = browserRoot.KatamonCoopMvp;
    const roomSession = config.session;
    const overlay = browserRoot.document.getElementById('coopBattle');
    const canvas = browserRoot.document.getElementById('coopBattleCanvas');
    const context = canvas.getContext('2d');
    const controlsEl = browserRoot.document.getElementById('coopBattleControls');
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
    let animationFrame = 0;
    let localRoundId = '';
    let localCommitted = false;
    let localDraft = null;
    let lastMoveSync = null;
    let advancingRoundId = '';
    let resultEntered = false;
    let resultOpenedAt = 0;
    let resultSummary = null;
    let rematchResolved = false;
    let shots = [];
    let notice = '';
    let noticeUntil = 0;
    const images = {};
    const background = new browserRoot.Image(); background.src = 'assets/stage-volcanic-bg.jpg';
    const bossAssetsPromise = deps.boss.preloadBossAssets(browserRoot);
    let bossAssets = {};
    bossAssetsPromise.then((value) => { bossAssets = value; });
    Object.values(state.roster).forEach((entry) => {
      if (!entry.assetPath) return;
      const image = new browserRoot.Image(); image.decoding = 'async'; image.src = entry.assetPath; images[entry.character] = image;
    });

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
      return active && room.phase === 'playing' && current?.status === 'input' && !localCommitted && deps.survival.canAct(player, state.round);
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
      const player = ownPlayer();
      localDraft = { x: player?.x || 180, fuelSpent: 0, aim: bossAim(state), weapon: { kind: 'normal', id: 'normal' } };
      populateWeapons(); setStatus(player?.status === 'down' ? 'DOWN — 仲間の救助を待っています' : '照準を決めて指を離すとREADY');
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
      const current = { x: localDraft.x };
      if (!deps.engine.shouldSyncMove(lastMoveSync, current, syncNow, final === true)) return;
      lastMoveSync = { x: localDraft.x, sentAt: syncNow };
      await sendMessage({ t: 'move', x: localDraft.x, fuelSpent: localDraft.fuelSpent, final: final === true }).catch(() => setStatus('移動同期を再試行します'));
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

    function pointerWorld(event) {
      const rect = canvas.getBoundingClientRect();
      const px = (event.clientX - rect.left) * canvas.width / rect.width;
      const py = (event.clientY - rect.top) * canvas.height / rect.height;
      return { x: clamp(px / WORLD_SCALE_X, 0, 1440), y: clamp((py - WORLD_TOP) / WORLD_SCALE_Y, 0, 660) };
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

    async function hostFinalizeIfReady() {
      if (!isHost() || room.phase !== 'playing' || currentRound()?.status !== 'input') return;
      const roundId = currentRound().id;
      const actions = committedActions(roundId); const moves = latestMoves(roundId); const now = serverNow();
      const humanSeats = Object.keys(state.roster).filter((seat) => !state.roster[seat].ai && deps.survival.canAct(state.party.players[seat], state.round));
      const connected = humanSeats.filter((seat) => now - safeNumber(room.slots?.[seat]?.seenAt, 0) <= DISCONNECT_DETECT_MS);
      const ready = connected.every((seat) => actions[seat]);
      if (!ready && now < currentRound().deadlineAt) return;
      const claimed = new Set();
      SEATS.filter((seat) => state.roster[seat]).forEach((seat) => {
        if (actions[seat]) return;
        const player = state.party.players[seat];
        if (!deps.survival.canAct(player, state.round)) return;
        if (state.roster[seat].ai || !connected.includes(seat)) actions[seat] = buildAiAction(state, seat, roundId, claimed);
        else actions[seat] = {
          x: moves[seat]?.x ?? player.x, fuelSpent: moves[seat]?.fuelSpent || 0,
          aim: bossAim(state), weapon: { kind: 'normal', id: 'normal' }, committedAt: now, auto: true,
        };
      });
      const scheduled = {};
      SEATS.filter((seat) => actions[seat]).forEach((seat, index) => {
        scheduled[seat] = { ...actions[seat], scheduledAt: now + index * deps.engine.VOLLEY_INTERVAL_MS, auto: actions[seat].auto === true };
      });
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
    function enterResult() {
      if (resultEntered) return;
      resultEntered = true; resultOpenedAt = safeNumber(currentRound()?.deadlineAt) - deps.session.REMATCH_WINDOW_MS;
      let cached = null;
      try { cached = JSON.parse(browserRoot.localStorage.getItem(cachedResultKey()) || 'null'); } catch (_) { cached = null; }
      if (cached?.matchId) resultSummary = cached;
      else {
        const progressBefore = foundation.loadState();
        const runtime = deps.session.createRuntime({ id: generation + '0'.repeat(40), seats: room.slots, bossId: deps.boss.BOSS_ID, difficulty: state.difficulty, stageId: state.stage.stageId });
        const preliminary = deps.session.resultSummary(runtime, { ...resultStats(state), firstClear: !progressBefore.boss.firstClears[state.difficulty] });
        const event = deps.session.rewardEvent(preliminary);
        const reward = event ? deps.rewards.recordEvent(progressBefore, event) : { state: progressBefore, credited: 0, newlyCompleted: [] };
        foundation.saveState(reward.state);
        resultSummary = deps.session.resultSummary(runtime, { ...resultStats(state), coins: reward.credited, firstClear: preliminary.firstClear, achievements: reward.newlyCompleted });
        try { browserRoot.localStorage.setItem(cachedResultKey(), JSON.stringify(resultSummary)); } catch (_) { /* 保存不可でも試合は続ける */ }
        if (reward.newlyCompleted?.length) browserRoot.KatamonMvpShop?.notifyAchievements(reward.newlyCompleted);
      }
      resultActionsEl.classList.add('open');
      controlsEl.classList.add('results');
      updateOwnReady(false).catch(() => {});
      setStatus('再戦受付 15秒');
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
      active = false; clearTimeout(pollTimer); clearTimeout(heartbeatTimer); cancelAnimationFrame(animationFrame);
      overlay.classList.remove('open'); overlay.setAttribute('aria-hidden', 'true'); bridge.setBattleAudio(false);
      if (nextRoom) config.onReturnLobby?.(nextRoom);
    }

    async function syncRoom() {
      const latest = await bridge.request(`coopRooms/${roomSession.code}`, roomSession.auth);
      if (!latest || !latest.slots?.[roomSession.seat]?.uid) throw new Error('協力部屋から退出しました');
      room = latest; roomSession.room = latest;
      const nextGeneration = revisionPrefix(room.settings?.revision || 1);
      if (nextGeneration !== generation && room.phase === 'playing') {
        generation = nextGeneration; processed = new Set(); resultEntered = false; rematchResolved = false;
        state = createBattleState({ matchId: generation + '0'.repeat(40), difficulty: room.settings?.difficulty, slots: room.slots, aiFill: room.settings?.aiFill, characters: config.characters });
      }
      if (await abortIfHostUnavailable()) return;
      replayVolleys();
      if (room.phase === 'lobby') { stop(room); return; }
      if (room.phase === 'results') { enterResult(); await hostResolveRematch(); return; }
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

    function drawTerrain() {
      const ctx = context; const stage = state.stage;
      ctx.beginPath(); ctx.moveTo(0, stage.terrainBottom);
      for (let column = 0; column < stage.segments.length; column += 1) ctx.lineTo(column * stage.columnWidth, stage.segments[column][0][0]);
      ctx.lineTo(stage.stageWidth, stage.terrainBottom); ctx.closePath();
      const gradient = ctx.createLinearGradient(0, 430, 0, stage.terrainBottom); gradient.addColorStop(0, '#665044'); gradient.addColorStop(1, '#191617');
      ctx.fillStyle = gradient; ctx.fill(); ctx.strokeStyle = '#a57a55'; ctx.lineWidth = 5; ctx.stroke();
      ctx.fillStyle = '#30363a'; ctx.fillRect(0, stage.rescuePlatform.y, stage.rescuePlatform.width, stage.rescuePlatform.height);
      ctx.strokeStyle = '#d29a46'; ctx.strokeRect(0, stage.rescuePlatform.y, stage.rescuePlatform.width, stage.rescuePlatform.height);
    }

    function drawPlayers() {
      Object.values(state.party.players).forEach((player) => {
        const roster = state.roster[player.seat]; const image = images[roster.character];
        context.save(); context.globalAlpha = player.status === 'down' ? 0.55 : 1;
        if (image?.complete && image.naturalWidth) context.drawImage(image, player.x - 46, player.y - 70, 92, 70);
        else { context.fillStyle = roster.color; context.beginPath(); context.arc(player.x, player.y - 18, 30, 0, Math.PI * 2); context.fill(); }
        context.lineWidth = 4; context.strokeStyle = player.status === 'down' ? '#e34f42' : roster.color; context.strokeRect(player.x - 40, player.y - 78, 80, 8);
        context.fillStyle = player.status === 'down' ? '#9d342f' : '#69cf72'; context.fillRect(player.x - 38, player.y - 76, 76 * player.hp / player.maxHp, 4);
        context.fillStyle = '#fff0c6'; context.font = 'bold 20px sans-serif'; context.textAlign = 'center'; context.fillText(player.status === 'down' ? 'DOWN' : roster.name, player.x, player.y - 86);
        context.restore();
      });
    }

    function drawGuide() {
      if (!ownCanInput() || !localDraft) return;
      const player = ownPlayer(); const [kind] = String(weaponEl.value || 'normal:normal').split(':');
      const color = kind === 'coopItem' ? (weaponEl.value.includes('debuff') ? '#a873ff' : '#65e092') : kind === 'subweapon' ? '#f29a38' : kind === 'special' ? '#ff5d4f' : '#ffffff';
      context.save(); context.strokeStyle = color; context.shadowColor = color; context.shadowBlur = 10; context.lineWidth = 5; context.setLineDash([14, 10]);
      context.beginPath(); context.moveTo(localDraft.x, player.y - 35); context.quadraticCurveTo((localDraft.x + localDraft.aim.x) / 2, Math.min(player.y, localDraft.aim.y) - 180, localDraft.aim.x, localDraft.aim.y); context.stroke();
      context.fillStyle = color; context.beginPath(); context.arc(localDraft.aim.x, localDraft.aim.y, 10, 0, Math.PI * 2); context.fill(); context.restore();
    }

    function drawShots(now) {
      shots = shots.filter((shot) => now < shot.endsAt + 150);
      shots.forEach((shot) => {
        const progress = clamp((now - shot.startsAt) / (shot.endsAt - shot.startsAt), 0, 1);
        if (progress <= 0 || progress >= 1) return;
        const x = shot.from.x + (shot.to.x - shot.from.x) * progress;
        const y = shot.from.y + (shot.to.y - shot.from.y) * progress - Math.sin(progress * Math.PI) * 150;
        context.save(); context.fillStyle = shot.color; context.shadowColor = shot.color; context.shadowBlur = 18; context.beginPath(); context.arc(x, y, 12, 0, Math.PI * 2); context.fill(); context.restore();
      });
    }

    function drawHud(now) {
      context.save(); context.fillStyle = '#081115e8'; context.fillRect(0, 0, 720, 50); context.strokeStyle = '#b77c34'; context.strokeRect(7, 7, 706, 38);
      context.fillStyle = '#ffe0a0'; context.font = '900 18px sans-serif'; context.textAlign = 'left'; context.fillText(`${deps.boss.BOSS_NAME}　${state.difficulty.toUpperCase()}`, 18, 32);
      const ratio = state.encounter.boss.body.hp / state.encounter.boss.body.maxHp; context.fillStyle = '#281316'; context.fillRect(390, 17, 300, 16); context.fillStyle = '#c44335'; context.fillRect(392, 19, 296 * ratio, 12);
      deps.ai.drawCoreGauge(context, state.encounter, { x: 390, y: 37, width: 300, height: 8 });
      context.fillStyle = '#071014e8'; context.fillRect(0, 520, 720, 220); context.strokeStyle = '#9a6a35'; context.strokeRect(7, 528, 706, 202);
      const cards = Object.values(state.party.players);
      cards.forEach((player, index) => {
        const x = 18 + (index % 2) * 347; const y = 542 + Math.floor(index / 2) * 86; const roster = state.roster[player.seat];
        context.fillStyle = '#122127'; context.fillRect(x, y, 332, 74); context.strokeStyle = roster.color; context.strokeRect(x, y, 332, 74);
        context.fillStyle = '#f9e6bc'; context.font = '900 16px sans-serif'; context.fillText(`P${SEATS.indexOf(player.seat) + 1} ${roster.name}${roster.ai ? ' [AI]' : ''}`, x + 10, y + 22);
        context.font = 'bold 13px sans-serif'; context.fillText(`${Math.ceil(player.hp)}/${player.maxHp} HP　燃料 ${Math.ceil(player.fuel)}　必殺 ${Math.ceil(player.specialGauge)}%`, x + 10, y + 47);
        context.fillStyle = player.status === 'down' ? '#ef6558' : '#88d996'; context.fillText(player.status === 'down' ? 'DOWN' : (localRoundId && committedActions(localRoundId)[player.seat] ? 'READY' : 'INPUT'), x + 255, y + 47);
      });
      if (notice && now < noticeUntil) { context.textAlign = 'center'; context.font = '900 34px sans-serif'; context.fillStyle = '#ffd66f'; context.strokeStyle = '#17100a'; context.lineWidth = 7; context.strokeText(notice, 360, 500); context.fillText(notice, 360, 500); }
      context.restore();
    }

    function drawResult() {
      if (!resultEntered || !resultSummary) return;
      context.save(); context.fillStyle = '#020507d9'; context.fillRect(25, 80, 670, 640); context.strokeStyle = '#c58b3d'; context.lineWidth = 4; context.strokeRect(25, 80, 670, 640);
      context.textAlign = 'center'; context.font = '900 54px sans-serif'; context.fillStyle = resultSummary.outcome === 'victory' ? '#ffd56a' : '#e96a55'; context.fillText(resultSummary.title, 360, 160);
      context.font = '900 22px sans-serif'; context.fillStyle = '#f4e3bf'; context.fillText(`${resultSummary.difficulty.toUpperCase()}　獲得 ${resultSummary.coins} 🪙`, 360, 210);
      context.font = 'bold 19px sans-serif'; context.fillText(`部位破壊 ${resultSummary.partsDestroyed}/${resultSummary.totalParts}　救助 ${resultSummary.rescues}回`, 360, 260);
      if (resultSummary.firstClear) { context.fillStyle = '#ffca52'; context.fillText('FIRST CLEAR BONUS', 360, 306); }
      const names = resultSummary.achievements.map((id) => deps.rewards.ACHIEVEMENTS.find((entry) => entry.id === id)?.name).filter(Boolean);
      context.fillStyle = '#b9d9d1'; context.font = 'bold 16px sans-serif'; context.fillText(names.length ? `実績達成: ${names.join(' / ')}` : '実績達成なし', 360, 350);
      const remaining = Math.max(0, Math.ceil((safeNumber(currentRound()?.deadlineAt) - serverNow()) / 1000)); context.fillStyle = '#ffe09a'; context.font = '900 26px sans-serif'; context.fillText(`再戦受付 ${remaining}秒`, 360, 420);
      context.font = 'bold 16px sans-serif'; context.fillStyle = '#d1c09d'; context.fillText('2人以上＋ホスト希望で同じ要塞・難易度・ステージへ', 360, 458); context.restore();
    }

    function draw() {
      if (!active) return;
      const now = performance.now(); context.clearRect(0, 0, 720, 960);
      if (background.complete && background.naturalWidth) context.drawImage(background, 0, WORLD_TOP, 720, 470); else { context.fillStyle = '#251418'; context.fillRect(0, WORLD_TOP, 720, 470); }
      context.save(); context.translate(0, WORLD_TOP); context.scale(WORLD_SCALE_X, WORLD_SCALE_Y); drawTerrain(); deps.boss.drawBoss(context, state.encounter.boss, state.stage.boss, bossAssets); drawPlayers(); drawGuide(); drawShots(now); context.restore();
      drawHud(now); drawResult(); animationFrame = requestAnimationFrame(draw);
    }

    browserRoot.document.getElementById('coopMoveLeft').onclick = () => moveOwn(-1);
    browserRoot.document.getElementById('coopMoveRight').onclick = () => moveOwn(1);
    weaponEl.onchange = () => { if (!ownCanInput()) populateWeapons(); };
    canvas.onpointermove = (event) => { if (ownCanInput() && event.buttons) localDraft.aim = pointerWorld(event); };
    canvas.onpointerup = (event) => { if (ownCanInput()) commitLocal(pointerWorld(event)); };
    browserRoot.document.getElementById('coopVoteRematch').onclick = () => updateOwnReady(true).then(() => {
      browserRoot.document.getElementById('coopVoteRematch').disabled = true; setStatus('再戦希望を送信しました');
    }).catch(() => setStatus('再戦希望を送れませんでした'));
    browserRoot.document.getElementById('coopReturnLobby').onclick = () => updateOwnReady(false).then(() => {
      setStatus('受付終了後にロビーへ戻ります');
    }).catch(() => setStatus('選択を送れませんでした'));

    overlay.classList.add('open'); overlay.setAttribute('aria-hidden', 'false'); bridge.setBattleAudio(true);
    resultActionsEl.classList.remove('open'); weaponEl.disabled = true; populateWeapons(); draw(); poll(); heartbeat();
    return { stop: () => stop(null), getState: () => clone(state) };
  }

  function startBrowser(config) {
    if (!root?.document || !config?.bridge || !config?.session) return false;
    mountBrowser(root);
    if (browserController) browserController.stop();
    browserController = createBrowserController(root, config);
    return true;
  }

  return Object.freeze({
    AI_PLAYER_WEIGHT,
    DISCONNECT_DETECT_MS,
    HOST_ABORT_AFTER_MS,
    POLL_INTERVAL_MS,
    HEARTBEAT_INTERVAL_MS,
    BASE_BODY_HP,
    BASE_PART_HP,
    BOSS_DAMAGE,
    playerCountRatio,
    revisionPrefix,
    makeRoundId,
    seededRandom,
    windForRound,
    activeRoster,
    createBattleState,
    buildAiAction,
    applyPlayerAction,
    applyBossTurn,
    resolveVolley,
    extractVolleys,
    resultStats,
    mountBrowser,
    startBrowser,
  });
});
