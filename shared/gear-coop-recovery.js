(function initKatamonGearCoopRecovery(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearCoopRecovery = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonGearCoopRecovery(root) {
  'use strict';
  function modules() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') return { foundation: require('../coop-mvp-foundation.js'), coopRewards: require('../coop-mvp-rewards.js'), rewards: require('./gear-rewards.js'), gearStorage: require('./gear-storage.js'), settlement: require('./gear-coop-settlement-storage.js') };
    return { foundation: root?.KatamonCoopMvp, coopRewards: root?.KatamonCoopRewards, rewards: root?.KatamonGearRewards, gearStorage: root?.KatamonGearStorage, settlement: root?.KatamonGearCoopSettlementStorage };
  }
  const stableJson = (value) => value === null || typeof value !== 'object' ? JSON.stringify(value)
    : Array.isArray(value) ? `[${value.map(stableJson).join(',')}]`
      : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  function containsSameReward(state, expected) {
    const pending = state.unclaimedRewards.find((reward) => reward.rewardId === expected.rewardId);
    if (pending && stableJson(pending) !== stableJson(expected)) throw new Error('cooperative Gear reward identity conflicts with durable storage');
    return !!pending || state.rewardLedger[expected.rewardId] === true;
  }
  async function recoverPendingCoopGearSettlement(storage, options = {}) {
    const api = modules(); const pending = api.settlement.load(storage); if (!pending) return { status: 'nothing_pending' };
    const result = await api.foundation.mutateStateLocked((state) => {
      if (state.rewardLedger[`event:${pending.eventId}`]) return { state, duplicate: true };
      if (pending.firstClear !== !state.boss.firstClears[pending.difficulty]) throw new Error('cooperative first-clear entitlement conflicts with Foundation state');
      // The stored canonical event is the only source used after a crash.
      // It preserves the first-clear entitlement captured before mutation.
      const recorded = api.coopRewards.recordEvent(state, pending.foundationEvent);
      return { state: recorded.state, duplicate: recorded.duplicate, newlyCompleted: recorded.newlyCompleted };
    }, options);
    const verifiedFoundation = api.foundation.loadState(storage);
    if (verifiedFoundation.rewardLedger[`event:${pending.eventId}`] !== true
      || (pending.firstClear && verifiedFoundation.boss.firstClears[pending.difficulty] !== true)) return { status: 'foundation_unverified', pending };
    const gear = api.gearStorage.loadGearState(storage);
    const exists = containsSameReward(gear, pending.reward);
    if (!exists) {
      const gate = api.rewards.getGearRewardGate(gear);
      if (!gate.allowed) return { status: 'capacity_blocked', pending, gate };
      await api.rewards.persistQueueReward(pending.reward, storage, options.lockManager ? { lockManager: options.lockManager } : undefined);
    }
    const after = api.gearStorage.loadGearState(storage);
    if (!containsSameReward(after, pending.reward)) return { status: 'gear_unverified', pending };
    // Compare the durable record at cleanup.  A stale tab must never remove a
    // new match's pending settlement after another tab completed this one.
    api.settlement.clear(pending, storage);
    return { status: 'recovered', pending, duplicateFoundation: result.duplicate === true };
  }
  return Object.freeze({ recoverPendingCoopGearSettlement });
});
