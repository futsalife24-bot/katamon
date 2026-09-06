(function (root, factory) {
  const api = factory(root.ContentStudioRegistration || (typeof require === 'function' ? require('./content-studio-registration.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ContentStudioRegistrationGame = api;
})(globalThis, function (registry) {
  'use strict';
  const map = { rooms:'registeredRooms', open:'registeredOpen', coopRooms:'registeredCoopRooms', coopOpen:'registeredCoopOpen' };
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  function message(code) {
    const text = String(code || '');
    if (!text.startsWith('registry.')) return text;
    const specific = {
      'registry.notDeployed':'登録対戦はまだ有効化されていません。従来の18体対戦は別の入口から利用できます。',
      'registry.activeChanged':'登録版が更新されたため準備を解除しました。この部屋の版は変更せず、新しい部屋で選び直してください。',
      'registry.runtimeIncompatible':'この登録版に対応するゲームへ更新してください。部屋と保存内容は変更していません。',
      'registry.cancelled':'読込を中止しました。再試行できます。',
      'registry.assetUnavailable':'必要な画像を取得できません。通信を確認して再試行してください。',
      'registry.timeout':'登録情報の取得が時間切れです。通信を確認して再試行してください。',
    };
    return specific[text] || '登録版または定義を確認できないため停止しました。再読込して確認してください（'+text+'）。';
  }
  class GameRegistry {
    constructor(read, legacy, fetchAsset = globalThis.fetch) {
      this.session = new registry.Session(read); this.legacy = legacy; this.fetchAsset = (...args) => fetchAsset(...args);
      this.checked = new Map(); this.generation = 0; this.controller = new AbortController();
      this.assetTail = Promise.resolve();
    }
    path(path) { const parts = path.split('/'); if (map[parts[0]]) parts[0] = map[parts[0]]; return parts.join('/'); }
    get revision() { return this.session.current?.registryRevision ?? null; }
    async pin(revision) {
      const generation = ++this.generation;
      this.controller.abort(); this.controller = new AbortController(); this.checked.clear();
      this.session.reset();
      const selected = revision === undefined ? (await this.session.active()).registryRevision : revision;
      if (generation !== this.generation) fail('registry.cancelled');
      const candidate = await this.session.pin(selected);
      if (generation !== this.generation) fail('registry.cancelled');
      for (const [id, legacy] of Object.entries(this.legacy)) {
        const definition = { ...legacy }; delete definition.motionSheets; delete definition.motionMetadata;
        const entry = registry.resolve(candidate,id);
        if (!entry.legacy || registry.stable(entry.definition) !== registry.stable(definition)) { this.session.reset(); fail('registry.runtimeIncompatible'); }
      }
      if (generation !== this.generation) fail('registry.cancelled');
      return Object.freeze(Object.fromEntries(Object.entries(candidate.characters).map(([id, entry]) => [id, registry.definition(entry)])));
    }
    resolve(id, hash) { return registry.resolve(this.session.current,id,hash); }
    packet(packet) {
      if (!this.revision) fail('registry.notPinned');
      return { ...packet, registryRevision:this.revision, ...(packet.t === 'reveal' ? { definitionHash:this.resolve(packet.character).definitionHash } : {}) };
    }
    validatePacket(packet) {
      if (!this.revision || packet.registryRevision !== this.revision) return 'packet.registryRevision';
      if (packet.t === 'reveal') { try { this.resolve(packet.character,packet.definitionHash); if (typeof packet.definitionHash !== 'string') return 'reveal.definitionHash'; } catch (_) { return 'reveal.definitionHash'; } }
      else if (packet.character !== undefined || packet.definitionHash !== undefined) return 'packet.selectionLeak';
      return '';
    }
    snapshotTag(units) {
      const definitions = {};
      for (const unit of units) if (unit.id !== 'boss1') definitions[unit.id] = this.resolve(unit.character).definitionHash;
      return { registryRevision:this.revision, definitionHashes:definitions };
    }
    validateSnapshot(snapshot, { gearEnabled = false, baseStats } = {}) {
      if (snapshot?.registryRevision !== this.revision || !snapshot?.definitionHashes || !Array.isArray(snapshot.units)) return 'snap.registryRevision';
      if (Object.keys(snapshot.definitionHashes).length !== snapshot.units.filter(unit => unit.id !== 'boss1').length) return 'snap.definitionHashes';
      try { for (const unit of snapshot.units) {
        if (unit.id === 'boss1') continue; // dedicated boss validation remains with coop
        const entry = this.resolve(unit.character,snapshot.definitionHashes[unit.id]);
        if (typeof snapshot.definitionHashes[unit.id] !== 'string') return 'snap.definitionHash';
        // Gear changes maxHp under its existing verified Gear start contract. The unmodified definition is still pinned.
        if (unit.maxHp !== entry.definition.maxHp && !gearEnabled) return 'snap.definition.maxHp';
        if (!gearEnabled && baseStats && unit.fuelMax !== baseStats(unit.character).baseFuel) return 'snap.definition.fuelMax';
      } } catch (_) { return 'snap.definition'; }
      return '';
    }
    async assets(id) {
      const entry = this.resolve(id), key = this.revision + ':' + id;
      if (this.checked.has(key)) return this.checked.get(key);
      const generation = this.generation, signal = this.controller.signal;
      // Serialize asset verification, including different characters. At most one bounded
      // response is retained; rendering still uses the separate motion cache budget.
      const pending = this.assetTail.then(async () => {
        for (const asset of entry.assets) {
          if (signal.aborted) fail('registry.cancelled');
          const motion = Object.values(entry.appearance.motionSheets || {}).includes(asset.path) || Object.values(entry.appearance.motionMetadata || {}).includes(asset.path);
          let response;
          try { response = await this.fetchAsset(asset.path, { cache:'no-store', signal:AbortSignal.any([signal,AbortSignal.timeout(12000)]) }); }
          catch (error) { if (motion && !signal.aborted) continue; throw error; }
          // A missing optional motion remains the existing static fallback. Received but
          // changed bytes are a different case and cannot establish the registered asset.
          if (!response.ok) { if (motion) continue; fail('registry.assetUnavailable'); }
          if (Number(response.headers.get('content-length') || 0) > asset.bytes) fail('registry.assetCapacity');
          const reader = response.body?.getReader(); if (!reader) fail('registry.assetUnavailable');
          const chunks = []; let length = 0;
          try { for (;;) { const {done,value} = await reader.read(); if (done) break; length += value.byteLength; if (length > asset.bytes) fail('registry.assetCapacity'); chunks.push(value); } }
          finally { await reader.cancel().catch(() => {}); }
          const bytes = new Uint8Array(length); let offset = 0; chunks.forEach(part => { bytes.set(part,offset); offset += part.byteLength; });
          if (length !== asset.bytes || await registry.hash(bytes) !== asset.sha256) fail('registry.assetHash');
        }
        if (generation !== this.generation) fail('registry.cancelled');
        return true;
      });
      this.assetTail = pending.catch(() => {});
      this.checked.set(key,pending); // failures are retained until explicit retry/reset, never re-requested per frame
      return pending;
    }
    reset() { this.generation++; this.controller.abort(); this.checked.clear(); this.session.reset(); }
  }
  return { GameRegistry, message };
});
