(function initKatamonCoopMvpFoundation(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonCoopMvp = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonCoopMvpFoundation() {
  'use strict';

  const STORAGE_KEY = 'katamon_coop_mvp_v1';
  const SCHEMA_VERSION = 1;
  const COIN_CAP = 9999;
  // Gear transaction と foundation 全体の writer が共有する排他領域。
  // foundation は Web Locks 非対応環境でも既存ゲームを継続できるが、
  // 対応環境では必ずこの名前の exclusive lock を使う。
  const STATE_MUTATION_LOCK_NAME = 'katamon_gear_v1:mutation';
  // 公開版では協力ボスを標準で有効にする。緊急停止は
  // `globalThis.KATAMON_FEATURES = { coopBossMvp: false }` で行う。
  const PRODUCTION_ENABLED = true;

  const deepFreeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
  };

  const DIFFICULTIES = deepFreeze([
    { id: 'normal', label: 'NORMAL', roundLimit: 12, coreExposeRounds: 2, coreDamageMultiplier: 2 },
    { id: 'hard', label: 'HARD', roundLimit: 15, coreExposeRounds: 2, coreDamageMultiplier: 1.75 },
    { id: 'extreme', label: 'EXTREME', roundLimit: 12, coreExposeRounds: 1, coreDamageMultiplier: 1.5 },
  ]);

  const COOP_ITEMS = deepFreeze([
    { id: 'rescue-kit', label: '救助弾', price: 0, initial: true, usesPerMatch: 1 },
    { id: 'healing-kit', label: '回復弾', price: 100, initial: false, usesPerMatch: 2 },
    { id: 'debuff-grenade', label: '弱体化弾', price: 200, initial: false, usesPerMatch: 1 },
  ]);

  const SUBWEAPONS = deepFreeze([
    { id: 'barrier', label: 'バリア', price: 100, usesPerMatch: 1 },
    { id: 'impact', label: '衝撃弾', price: 200, usesPerMatch: 1 },
    { id: 'drill', label: '掘削弾', price: 200, usesPerMatch: 1 },
  ]);

  const COSMETICS = deepFreeze([
    { id: 'icon-brass', label: '真鍮アイコン', kind: 'icon', price: 100 },
    { id: 'shell-amber', label: '琥珀砲弾', kind: 'projectile', price: 150 },
    { id: 'impact-cyan', label: '蒼光着弾', kind: 'impact', price: 200 },
  ]);

  const SHOP_ITEMS = deepFreeze([...SUBWEAPONS, ...COOP_ITEMS, ...COSMETICS]);
  const ITEM_IDS = new Set(SHOP_ITEMS.map((entry) => entry.id));
  const COOP_ITEM_IDS = new Set(COOP_ITEMS.map((entry) => entry.id));
  const SUBWEAPON_IDS = new Set(SUBWEAPONS.map((entry) => entry.id));
  const COSMETIC_IDS = new Set(COSMETICS.map((entry) => entry.id));
  const DIFFICULTY_IDS = new Set(DIFFICULTIES.map((entry) => entry.id));

  const integerInRange = (value, min, max, fallback = min) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(number)));
  };

  const trueEntries = (source, allowedIds = null) => {
    const result = {};
    if (!source || typeof source !== 'object' || Array.isArray(source)) return result;
    Object.entries(source).forEach(([key, value]) => {
      if (value === true && (!allowedIds || allowedIds.has(key))) result[key] = true;
    });
    return result;
  };

  const nonNegativeEntries = (source) => {
    const result = {};
    if (!source || typeof source !== 'object' || Array.isArray(source)) return result;
    Object.entries(source).forEach(([key, value]) => {
      const amount = integerInRange(value, 0, COIN_CAP, 0);
      if (amount > 0) result[key] = amount;
    });
    return result;
  };

  function createDefaultState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      wallet: { coins: 0 },
      inventory: { 'rescue-kit': true },
      equipment: {
        coopItem: 'rescue-kit', subweapon: null, cosmetic: null,
        cosmetics: { icon: null, projectile: null, impact: null },
      },
      boss: { unlockedDifficulties: ['normal'], firstClears: {} },
      achievements: { progress: {}, completed: {}, claimed: {} },
      rewardLedger: {},
      pendingRewards: {},
      coopStats: {
        clears: 0,
        hardClears: 0,
        extremeClears: 0,
        rescues: 0,
        partBreaks: 0,
        noDownClears: 0,
      },
    };
  }

  function normalizeState(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const state = createDefaultState();
    state.wallet.coins = integerInRange(source.wallet?.coins, 0, COIN_CAP, 0);
    state.inventory = trueEntries(source.inventory, ITEM_IDS);
    state.inventory['rescue-kit'] = true;

    const requestedCoopItem = source.equipment?.coopItem;
    const requestedSubweapon = source.equipment?.subweapon;
    const requestedCosmetic = source.equipment?.cosmetic;
    state.equipment.coopItem = COOP_ITEM_IDS.has(requestedCoopItem) && state.inventory[requestedCoopItem]
      ? requestedCoopItem
      : 'rescue-kit';
    state.equipment.subweapon = SUBWEAPON_IDS.has(requestedSubweapon) && state.inventory[requestedSubweapon]
      ? requestedSubweapon
      : null;
    state.equipment.cosmetic = COSMETIC_IDS.has(requestedCosmetic) && state.inventory[requestedCosmetic]
      ? requestedCosmetic
      : null;
    const requestedCosmetics = source.equipment?.cosmetics;
    for (const kind of ['icon', 'projectile', 'impact']) {
      const requested = requestedCosmetics?.[kind];
      const item = COSMETICS.find((entry) => entry.id === requested && entry.kind === kind);
      if (item && state.inventory[item.id]) state.equipment.cosmetics[kind] = item.id;
    }
    // v1初期版の単一cosmetic欄を、種類別装備へ後方互換で移行する。
    const legacyCosmetic = COSMETICS.find((entry) => entry.id === state.equipment.cosmetic);
    if (legacyCosmetic && !state.equipment.cosmetics[legacyCosmetic.kind]) {
      state.equipment.cosmetics[legacyCosmetic.kind] = legacyCosmetic.id;
    }

    const requestedDifficulties = Array.isArray(source.boss?.unlockedDifficulties)
      ? source.boss.unlockedDifficulties
      : [];
    state.boss.unlockedDifficulties = [...new Set(['normal', ...requestedDifficulties])]
      .filter((id) => DIFFICULTY_IDS.has(id));
    state.boss.firstClears = trueEntries(source.boss?.firstClears, DIFFICULTY_IDS);

    state.achievements.progress = nonNegativeEntries(source.achievements?.progress);
    state.achievements.completed = trueEntries(source.achievements?.completed);
    state.achievements.claimed = trueEntries(source.achievements?.claimed);
    state.rewardLedger = trueEntries(source.rewardLedger);
    state.pendingRewards = nonNegativeEntries(source.pendingRewards);

    Object.keys(state.coopStats).forEach((key) => {
      state.coopStats[key] = integerInRange(source.coopStats?.[key], 0, 999999, 0);
    });
    return state;
  }

  function loadState(storage) {
    const target = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!target?.getItem) return createDefaultState();
    try {
      const saved = target.getItem(STORAGE_KEY);
      return normalizeState(saved ? JSON.parse(saved) : null);
    } catch (_error) {
      return createDefaultState();
    }
  }

  function saveState(state, storage) {
    const normalized = normalizeState(state);
    const target = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!target?.setItem) return normalized;
    try {
      target.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch (_error) {
      // 容量不足やプライベートモードでも、ゲーム本体は止めない。
    }
    return normalized;
  }

  class FoundationStateMutationError extends Error {
    constructor(code, message, cause) {
      super(message || code);
      this.name = 'FoundationStateMutationError';
      this.code = code;
      if (cause !== undefined) this.cause = cause;
    }
  }

  function mutationError(code, message, cause) {
    throw new FoundationStateMutationError(code, message, cause);
  }

  function resolveStateMutationLockManager(options) {
    if (Object.prototype.hasOwnProperty.call(options, 'lockManager')) {
      const injected = options.lockManager;
      if (injected == null) return null;
      if (typeof injected.request !== 'function') {
        mutationError('FOUNDATION_LOCK_INVALID', 'lockManager.request must be a function');
      }
      return injected;
    }
    try {
      if (typeof navigator !== 'undefined'
        && navigator.locks
        && typeof navigator.locks.request === 'function') {
        return navigator.locks;
      }
    } catch (_error) {
      // Web Locksを参照できない環境は、未対応環境と同じfallbackへ進む。
    }
    return null;
  }

  // Web Locks 非対応環境でも、同一タブ内の既存writer同士だけは順番を守る。
  // 別タブ排他を保証する代替ではないため、Gear transaction側は従来どおり
  // Web Locksなしではfail closedする。
  let fallbackMutationTail = Promise.resolve();

  async function withStateMutationLock(operation, options = {}) {
    if (typeof operation !== 'function') {
      mutationError('FOUNDATION_MUTATION_INVALID', 'operation must be a function');
    }
    const normalizedOptions = options && typeof options === 'object' ? options : {};
    const lockManager = resolveStateMutationLockManager(normalizedOptions);
    if (!lockManager) {
      const queued = fallbackMutationTail.then(operation, operation);
      fallbackMutationTail = queued.then(() => undefined, () => undefined);
      return queued;
    }

    let callbackInvoked = false;
    let operationError = null;
    try {
      const result = await lockManager.request(
        STATE_MUTATION_LOCK_NAME,
        { mode: 'exclusive' },
        async (lock) => {
          callbackInvoked = true;
          if (lock == null) {
            mutationError('FOUNDATION_LOCK_NOT_ACQUIRED', 'exclusive foundation mutation lock was not acquired');
          }
          try {
            return await operation();
          } catch (error) {
            operationError = error;
            throw error;
          }
        },
      );
      if (!callbackInvoked) {
        mutationError('FOUNDATION_LOCK_NOT_ACQUIRED', 'exclusive foundation mutation lock callback was not run');
      }
      return result;
    } catch (error) {
      if (error === operationError || error instanceof FoundationStateMutationError) throw error;
      mutationError('FOUNDATION_LOCK_FAILED', 'could not acquire or run the exclusive foundation mutation lock', error);
    }
  }

  async function mutateStateLocked(mutator, options = {}) {
    if (typeof mutator !== 'function') {
      mutationError('FOUNDATION_MUTATION_INVALID', 'mutator must be a function');
    }
    const normalizedOptions = options && typeof options === 'object' ? options : {};
    const storage = normalizedOptions.storage;
    return withStateMutationLock(async () => {
      const currentState = loadState(storage);
      const mutationResult = await mutator(currentState);
      if (!mutationResult || typeof mutationResult !== 'object' || Array.isArray(mutationResult)
        || !mutationResult.state || typeof mutationResult.state !== 'object' || Array.isArray(mutationResult.state)) {
        mutationError('FOUNDATION_MUTATION_RESULT_INVALID', 'mutator must return an object containing state');
      }
      const savedState = saveState(mutationResult.state, storage);
      return { ...mutationResult, state: savedState };
    }, normalizedOptions);
  }

  function isDevelopmentHost(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '::1' || host.startsWith('127.')) return true;
    if (/^10\./.test(host) || /^192\.168\./.test(host)) return true;
    const match = /^172\.(\d{1,2})\./.exec(host);
    return !!match && Number(match[1]) >= 16 && Number(match[1]) <= 31;
  }

  function isFeatureEnabled(locationLike, features) {
    if (PRODUCTION_ENABLED) return features?.coopBossMvp !== false;
    const locationValue = locationLike || (typeof location !== 'undefined' ? location : {});
    if (!isDevelopmentHost(locationValue.hostname)) return false;
    let queryEnabled = false;
    try {
      queryEnabled = new URLSearchParams(locationValue.search || '').get('coopMvp') === '1';
    } catch (_error) {
      queryEnabled = false;
    }
    return features?.coopBossMvp === true || queryEnabled;
  }

  function grantCoins(currentState, amount, rewardId = null, options = {}) {
    const state = normalizeState(currentState);
    const normalizedRewardId = typeof rewardId === 'string' && rewardId.trim() ? rewardId.trim() : null;
    if (normalizedRewardId && state.rewardLedger[normalizedRewardId]) {
      return { state, credited: 0, pending: state.pendingRewards[normalizedRewardId] || 0, duplicate: true };
    }
    const requested = integerInRange(amount, 0, COIN_CAP, 0);
    const credited = Math.min(requested, COIN_CAP - state.wallet.coins);
    const pending = requested - credited;
    state.wallet.coins += credited;
    if (normalizedRewardId) {
      state.rewardLedger[normalizedRewardId] = true;
      if (pending > 0 && options.preserveOverflow !== false) state.pendingRewards[normalizedRewardId] = pending;
    }
    return { state, credited, pending, duplicate: false };
  }

  function claimPendingReward(currentState, rewardId) {
    const state = normalizeState(currentState);
    const pending = state.pendingRewards[rewardId] || 0;
    if (pending <= 0) return { state, credited: 0, pending: 0 };
    const credited = Math.min(pending, COIN_CAP - state.wallet.coins);
    state.wallet.coins += credited;
    const remaining = pending - credited;
    if (remaining > 0) state.pendingRewards[rewardId] = remaining;
    else delete state.pendingRewards[rewardId];
    return { state, credited, pending: remaining };
  }

  return deepFreeze({
    STORAGE_KEY,
    SCHEMA_VERSION,
    COIN_CAP,
    STATE_MUTATION_LOCK_NAME,
    PRODUCTION_ENABLED,
    DIFFICULTIES,
    COOP_ITEMS,
    SUBWEAPONS,
    COSMETICS,
    SHOP_ITEMS,
    createDefaultState,
    normalizeState,
    loadState,
    saveState,
    FoundationStateMutationError,
    withStateMutationLock,
    mutateStateLocked,
    isDevelopmentHost,
    isFeatureEnabled,
    grantCoins,
    claimPendingReward,
  });
});
