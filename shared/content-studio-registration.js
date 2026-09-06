(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ContentStudioRegistration = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const CONTRACT = 'katamon-gameplay-1';
  const HASH = /^[a-f0-9]{64}$/;
  const ID = /^[a-zA-Z][a-zA-Z0-9-]{0,23}$/;
  const CLIPS = ['move-forward', 'move-backward', 'fire', 'hit', 'land'];
  const MAX_BYTES = 2 * 1024 * 1024;
  function fail(code) { throw Object.assign(new Error(code), { code }); }
  function exact(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join('|') !== keys.slice().sort().join('|')) fail('registry.schema');
  }
  function stable(value, depth = 0) {
    if (depth > 16) fail('registry.depth');
    if (value === null || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (typeof value === 'string' && value.length <= MAX_BYTES) return JSON.stringify(value);
    if (Array.isArray(value) && value.length <= 512) return '[' + value.map(v => stable(v, depth + 1)).join(',') + ']';
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) fail('registry.value');
    const keys = Object.keys(value).sort();
    if (keys.length > 512 || keys.some(k => ['__proto__', 'prototype', 'constructor'].includes(k))) fail('registry.key');
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stable(value[k], depth + 1)).join(',') + '}';
  }
  async function hash(value) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  }
  function assetPath(path) {
    return typeof path === 'string' && (/^assets\/characters\/(runtime\/[a-z0-9_-]+\.webp|master\/[a-z0-9_-]+\.png)$/.test(path)
      || /^assets\/content-studio\/[a-z][a-z0-9-]{0,23}\/[a-f0-9]{12}\/(character\.(png|webp)|icon\.png|thumbnail\.webp|(idle|move-forward|move-backward|fire|hit|land)\.(png|json))$/.test(path));
  }
  function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  }
  function gameplayDefinition(definition) {
    // These are the values consumed by battle/CPU/standard declarative skills.
    // Rendering references and editor inputs never change this gameplay hash.
    const keys = ['key','maxHp','blastMul','windMul','fuelMul','velScaleMul','damageTakenMul','guideMul','gravityMul','specialVelocityMul','tBias','empRadius','specialEnabled','normalSkill','specialSkill','implementationVersion'];
    return Object.fromEntries(keys.filter(key => Object.hasOwn(definition,key)).map(key => [key,definition[key]]));
  }
  async function verify(candidate, expectedRevision) {
    exact(candidate, ['schemaVersion', 'runtimeContract', 'registryRevision', 'characters']);
    if (candidate.schemaVersion !== 1 || candidate.runtimeContract !== CONTRACT) fail('registry.unsupported');
    if (!HASH.test(candidate.registryRevision) || (expectedRevision && expectedRevision !== candidate.registryRevision)) fail('registry.revision');
    if (new TextEncoder().encode(stable(candidate)).byteLength > MAX_BYTES) fail('registry.capacity');
    const entries = candidate.characters;
    if (!entries || Array.isArray(entries) || typeof entries !== 'object' || !Object.keys(entries).length || Object.keys(entries).length > 500) fail('registry.characters');
    const ids = new Set(), slugs = new Set();
    for (const [id, entry] of Object.entries(entries)) {
      exact(entry, ['gameId', 'slug', 'legacy', 'definition', 'definitionHash', 'appearance', 'assets']);
      if (!ID.test(id) || entry.gameId !== id || !/^[a-z][a-z0-9-]{0,23}$/.test(entry.slug) || typeof entry.legacy !== 'boolean') fail('registry.identity');
      if (ids.has(id.toLowerCase()) || slugs.has(entry.slug.toLowerCase())) fail('registry.collision');
      ids.add(id.toLowerCase()); slugs.add(entry.slug.toLowerCase());
      if (!entry.definition || entry.definition.key !== id || !Number.isFinite(entry.definition.maxHp) || entry.definition.maxHp < 1 || entry.definition.maxHp > 200
        || entry.definition.motionSheets || entry.definition.motionMetadata || !HASH.test(entry.definitionHash)
        || await hash(stable(gameplayDefinition(entry.definition))) !== entry.definitionHash) fail('registry.definition');
      exact(entry.appearance, ['motionSheets', 'motionMetadata']);
      const paths = new Set();
      if (!Array.isArray(entry.assets) || entry.assets.length > 16) fail('registry.assets');
      for (const asset of entry.assets) {
        exact(asset, ['path', 'sha256', 'bytes']);
        if (!assetPath(asset.path) || !HASH.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > 6 * 1024 * 1024 || paths.has(asset.path)) fail('registry.asset');
        if (asset.path.startsWith('assets/content-studio/') && !asset.path.startsWith('assets/content-studio/' + entry.slug + '/')) fail('registry.assetOwner');
        paths.add(asset.path);
      }
      for (const field of ['motionSheets', 'motionMetadata']) {
        const map = entry.appearance[field];
        if (map === null) continue;
        exact(map, CLIPS);
        for (const clip of CLIPS) if (!paths.has(map[clip]) || !map[clip].endsWith('/' + clip + (field === 'motionSheets' ? '.png' : '.json'))) fail('registry.motion');
      }
      if (Boolean(entry.appearance.motionSheets) !== Boolean(entry.appearance.motionMetadata)) fail('registry.motion');
      const staticPath = entry.legacy ? 'assets/characters/runtime/' + entry.definition.asset + '.webp' : entry.definition.assetBase + '.webp';
      if (!paths.has(staticPath)) fail('registry.static');
    }
    const { registryRevision, ...content } = candidate;
    if (await hash(stable(content)) !== registryRevision) fail('registry.hash');
    return freeze(JSON.parse(stable(candidate)));
  }
  async function create(characters) {
    const content = { schemaVersion: 1, runtimeContract: CONTRACT, characters };
    return verify({ ...content, registryRevision: await hash(stable(content)) });
  }
  // RTDB deletes null properties and empty maps. Preserve exact canonical bytes in JSON,
  // with a separately verified minimal index for Rules (which cannot parse JSON strings).
  function storage(candidate) {
    return { schemaVersion:1, runtimeContract:candidate.runtimeContract, registryRevision:candidate.registryRevision,
      payload:stable(candidate), characters:Object.fromEntries(Object.entries(candidate.characters).map(([id,entry]) => [id,{gameId:id,definitionHash:entry.definitionHash}])) };
  }
  async function verifyStored(stored, revision) {
    exact(stored,['schemaVersion','runtimeContract','registryRevision','payload','characters']);
    if (typeof stored.payload !== 'string' || new TextEncoder().encode(stored.payload).length > MAX_BYTES) fail('registry.capacity');
    let parsed; try { parsed = JSON.parse(stored.payload); } catch (_) { fail('registry.json'); }
    const candidate = await verify(parsed,revision);
    const expected = storage(candidate);
    const {payload, ...index} = stored;
    const {payload: expectedPayload, ...expectedIndex} = expected;
    if (payload !== expectedPayload || stable(index) !== stable(expectedIndex)) fail('registry.indexMismatch');
    return candidate;
  }
  async function readJson(response, maximum = MAX_BYTES * 2) {
    if (Number(response.headers.get('content-length') || 0) > maximum) fail('registry.capacity');
    const reader = response.body?.getReader(); if (!reader) fail('registry.unavailable');
    const parts = []; let length = 0, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; reader.cancel().catch(() => {}); }, 12000);
    try {
      for (;;) { const {done,value} = await reader.read(); if (done) break; length += value.byteLength; if (length > maximum) fail('registry.capacity'); parts.push(value); }
      if (timedOut) fail('registry.timeout');
      const bytes = new Uint8Array(length); let offset = 0;
      for (const part of parts) { bytes.set(part,offset); offset += part.byteLength; }
      try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); } catch (_) { fail('registry.json'); }
    } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); }
  }
  function resolve(candidate, gameId, definitionHash) {
    const entry = candidate?.characters?.[gameId];
    if (!entry || entry.gameId !== gameId || (definitionHash !== undefined && entry.definitionHash !== definitionHash)) fail('registry.unknownDefinition');
    return entry;
  }
  function definition(entry) {
    return freeze({ ...entry.definition, ...(entry.appearance.motionSheets ? entry.appearance : {}) });
  }
  function binding({ registryRevision, room, round, seat, character, nonce, gear = null }) {
    if (!HASH.test(registryRevision) || !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(room)
        || !/^[a-f0-9]{48}$/.test(round) || !['p1','e1','s1','s2'].includes(seat) || !ID.test(character)
        || !/^[a-f0-9]{48}$/.test(nonce) || (gear !== null && typeof gear !== 'string')) fail('registry.commitment');
    return hash(stable({ contract: 'registered-reveal-1', registryRevision, room, round, seat, character, nonce, gear }));
  }
  class Session {
    constructor(read) { this.read = read; this.generation = 0; this.current = null; this.started = false; }
    reset() { this.generation++; this.current = null; this.started = false; }
    async pin(revision) {
      if (!HASH.test(revision)) fail('registry.revision');
      const generation = ++this.generation;
      const candidate = await verifyStored(await this.read('characterRegistry/revisions/' + revision), revision);
      if (generation !== this.generation) fail('registry.cancelled');
      this.current = candidate; this.started = false; return candidate;
    }
    async active() {
      const active = await this.read('characterRegistry/active');
      if (!active) fail('registry.notDeployed');
      exact(active, ['registryRevision','generation','sourceSha']);
      if (!HASH.test(active.registryRevision) || !Number.isSafeInteger(active.generation) || active.generation < 1 || !/^[a-f0-9]{40}$/.test(active.sourceSha)) fail('registry.active');
      return active;
    }
    async assertNewStart() {
      if (!this.current || (await this.active()).registryRevision !== this.current.registryRevision) fail('registry.activeChanged');
    }
    async start() { await this.assertNewStart(); this.started = true; }
  }
  return Object.freeze({ CONTRACT, MAX_BYTES, CLIPS, stable, hash, assetPath, gameplayDefinition, verify, create, storage, verifyStored, readJson, resolve, definition, binding, Session });
});
