(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StageStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DB_NAME = 'stage-studio';
  const DB_VERSION = 2;
  const RECORD_VERSION = 2;
  const STORES = Object.freeze({ drafts: 'drafts', custom: 'customStages' });
  const STORAGE_LIMITS = Object.freeze({
    maxRecordBytes: 12 * 1024 * 1024,
    maxPreviewBytes: 4 * 1024 * 1024,
    maxHistoryEntries: 80,
    defaultAutosaveDelayMs: 450
  });
  const memoryDatabases = new Map();

  class StageStorageError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = 'StageStorageError';
      this.code = code;
      if (details !== undefined) this.details = details;
    }
  }

  function fail(code, message, details) {
    throw new StageStorageError(code, message, details);
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  function clone(value, seen) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    if (value == null || typeof value !== 'object') return value;
    const visited = seen || new Map();
    if (visited.has(value)) fail('record.cyclic', '循環参照を含むデータは保存できません。');
    if (value instanceof Date) return new Date(value.getTime());
    if (typeof Blob !== 'undefined' && value instanceof Blob) return value.slice(0, value.size, value.type);
    if (value instanceof Uint8Array) return new Uint8Array(value);
    if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return value.slice(0);
    const result = Array.isArray(value) ? [] : {};
    visited.set(value, result);
    Object.keys(value).forEach((key) => { result[key] = clone(value[key], visited); });
    visited.delete(value);
    return result;
  }

  function utf8Length(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(text)).length;
    if (typeof Buffer !== 'undefined') return Buffer.byteLength(String(text), 'utf8');
    return unescape(encodeURIComponent(String(text))).length;
  }

  function estimateValueBytes(root) {
    const active = new Set();
    const stack = [{ value: root, exit: false }];
    let bytes = 0;
    while (stack.length) {
      const item = stack.pop();
      const value = item.value;
      if (item.exit) {
        active.delete(value);
        continue;
      }
      if (value == null) { bytes += 4; continue; }
      const type = typeof value;
      if (type === 'string') { bytes += utf8Length(value); continue; }
      if (type === 'number') { bytes += 8; continue; }
      if (type === 'boolean') { bytes += 4; continue; }
      if (type === 'undefined') continue;
      if (type === 'function' || type === 'symbol' || type === 'bigint') fail('record.unsupported', '保存できない値が含まれています。');
      if (typeof Blob !== 'undefined' && value instanceof Blob) { bytes += value.size; continue; }
      if (value instanceof Uint8Array) { bytes += value.byteLength; continue; }
      if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) { bytes += value.byteLength; continue; }
      if (active.has(value)) fail('record.cyclic', '循環参照を含むデータは保存できません。');
      active.add(value);
      stack.push({ value, exit: true });
      Object.keys(value).forEach((key) => {
        bytes += utf8Length(key);
        stack.push({ value: value[key], exit: false });
      });
    }
    return bytes;
  }

  function resolveCore(provided) {
    if (provided) return provided;
    if (typeof globalThis !== 'undefined' && globalThis.StageCore) return globalThis.StageCore;
    if (typeof require === 'function') {
      try { return require('./stage-core.js'); } catch (_) { return null; }
    }
    return null;
  }

  function fallbackId() {
    const bytes = new Uint8Array(12);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else {
      let seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
      for (let i = 0; i < bytes.length; i++) {
        seed = (Math.imul(seed ^ (seed >>> 15), 2246822519) + i) >>> 0;
        bytes[i] = seed & 0xff;
      }
    }
    return 'stg_' + Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  }

  function normalizeIso(value, fallback) {
    const date = value ? new Date(value) : new Date(fallback || Date.now());
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(fallback || Date.now()).toISOString();
  }

  function recordId(value) {
    const stage = value && (value.stage || value.document || (value.schemaVersion ? value : null));
    const id = value && value.id || stage && stage.stageId;
    if (!id || typeof id !== 'string' || id.length > 80 || /[\u0000-\u001f]/.test(id)) fail('record.id', '保存データのIDが不正です。');
    return id;
  }

  function trimHistory(history) {
    if (!Array.isArray(history)) return [];
    return clone(history.slice(-STORAGE_LIMITS.maxHistoryEntries));
  }

  function migrateRecord(raw, kind, core) {
    if (!isPlainObject(raw)) return null;
    if (Number(raw.storageVersion || 1) > RECORD_VERSION) return null;
    let stage;
    let source;
    if (isPlainObject(raw.stage)) {
      stage = clone(raw.stage);
      source = raw;
    } else if (isPlainObject(raw.document)) {
      stage = clone(raw.document);
      source = raw;
    } else if (typeof raw.schemaVersion === 'string') {
      stage = clone(raw);
      source = {};
    } else {
      return null;
    }
    if (core && typeof core.migrateStage === 'function') {
      const migrated = core.migrateStage(stage);
      if (!migrated) return null;
      stage = migrated;
    }
    const id = source.id || stage.stageId;
    if (!id || typeof id !== 'string' || id.length > 80) return null;
    const createdAt = normalizeIso(source.createdAt || stage.createdAt, 0);
    const updatedAt = normalizeIso(source.updatedAt || stage.updatedAt, Date.now());
    const result = {
      storageVersion: RECORD_VERSION,
      id,
      kind,
      title: String(source.title || source.displayName || stage.title || 'ステージ').slice(0, 80),
      displayName: String(source.displayName || '').slice(0, 80),
      createdAt,
      updatedAt,
      stage
    };
    if (kind === 'drafts') {
      result.history = trimHistory(source.history);
      result.redoHistory = trimHistory(source.redoHistory);
      result.editorState = isPlainObject(source.editorState) ? clone(source.editorState)
        : (isPlainObject(source.editor) ? clone(source.editor) : {});
      result.editor = isPlainObject(source.editor) ? clone(source.editor) : clone(result.editorState);
      result.validation = isPlainObject(source.validation) ? clone(source.validation) : null;
      result.lastScreen = typeof source.lastScreen === 'string' ? source.lastScreen.slice(0, 64) : 'home';
      result.generationSettings = isPlainObject(source.generationSettings) ? clone(source.generationSettings) : {};
      if (source.preview != null) result.preview = clone(source.preview);
    } else {
      result.importedAt = normalizeIso(source.importedAt, updatedAt);
      result.fileSize = Number.isFinite(source.fileSize) && source.fileSize >= 0 ? Math.round(source.fileSize) : 0;
      result.warnings = Array.isArray(source.warnings) ? clone(source.warnings.slice(0, 100)) : [];
      if (source.preview != null) result.preview = clone(source.preview);
      if (isPlainObject(source.assets)) result.assets = clone(source.assets);
    }
    result.byteLength = estimateValueBytes(result);
    if (result.byteLength > STORAGE_LIMITS.maxRecordBytes) fail('record.tooLarge', '保存データが端末保存の上限を超えています。');
    if (result.preview && typeof Blob !== 'undefined' && result.preview instanceof Blob && result.preview.size > STORAGE_LIMITS.maxPreviewBytes) {
      fail('preview.tooLarge', 'プレビュー画像が大きすぎます。');
    }
    return result;
  }

  function makeRecord(value, kind, core, now) {
    if (!isPlainObject(value)) fail('record.structure', '保存データの構造が不正です。');
    const input = value.stage || value.document ? clone(value) : { stage: clone(value) };
    const stage = input.stage || input.document;
    const id = recordId(input.stage ? input : stage);
    const existingCreatedAt = input.createdAt || stage.createdAt;
    input.id = id;
    input.kind = kind;
    input.createdAt = normalizeIso(existingCreatedAt, now);
    input.updatedAt = normalizeIso(now, Date.now());
    input.storageVersion = RECORD_VERSION;
    const migrated = migrateRecord(input, kind, core);
    if (!migrated) fail('record.version', '対応していない保存データです。');
    migrated.updatedAt = normalizeIso(now, Date.now());
    migrated.byteLength = estimateValueBytes(migrated);
    return migrated;
  }

  class MemoryBackend {
    constructor(name) {
      this.name = name;
      if (!memoryDatabases.has(name)) memoryDatabases.set(name, { drafts: new Map(), customStages: new Map() });
      this.data = memoryDatabases.get(name);
      this.type = 'memory';
      this.durable = false;
    }

    async put(store, value) {
      this.data[store].set(value.id, clone(value));
    }

    async get(store, id) {
      const value = this.data[store].get(id);
      return value == null ? undefined : clone(value);
    }

    async getAll(store) {
      return Array.from(this.data[store].values(), (value) => clone(value));
    }

    async delete(store, id) {
      return this.data[store].delete(id);
    }

    close() {}
  }

  function requestPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }

  function transactionPromise(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
    });
  }

  function readAll(store) {
    if (typeof store.getAll === 'function') return requestPromise(store.getAll());
    return new Promise((resolve, reject) => {
      const values = [];
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(values); return; }
        values.push(cursor.value);
        cursor.continue();
      };
      request.onerror = () => reject(request.error || new Error('IndexedDB cursor failed'));
    });
  }

  class IndexedDbBackend {
    constructor(db) {
      this.db = db;
      this.type = 'indexeddb';
      this.durable = true;
    }

    async put(storeName, value) {
      const tx = this.db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(clone(value));
      await transactionPromise(tx);
    }

    async get(storeName, id) {
      const tx = this.db.transaction(storeName, 'readonly');
      const done = transactionPromise(tx);
      const value = await requestPromise(tx.objectStore(storeName).get(id));
      await done;
      return value;
    }

    async getAll(storeName) {
      const tx = this.db.transaction(storeName, 'readonly');
      const done = transactionPromise(tx);
      const values = await readAll(tx.objectStore(storeName));
      await done;
      return values;
    }

    async delete(storeName, id) {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const existsRequest = store.count(id);
      store.delete(id);
      const done = transactionPromise(tx);
      const exists = await requestPromise(existsRequest);
      await done;
      return exists > 0;
    }

    close() {
      this.db.close();
    }
  }

  function openIndexedDb(indexedDb, name) {
    return new Promise((resolve, reject) => {
      const request = indexedDb.open(name, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        Object.values(STORES).forEach((storeName) => {
          if (db.objectStoreNames.contains(storeName)) return;
          const store = db.createObjectStore(storeName, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
          store.createIndex('title', 'title', { unique: false });
        });
      };
      request.onblocked = () => reject(new StageStorageError('database.blocked', '別の画面が端末保存の更新を妨げています。'));
      request.onerror = () => reject(request.error || new StageStorageError('database.open', '端末保存を開けませんでした。'));
      request.onsuccess = () => resolve(new IndexedDbBackend(request.result));
    });
  }

  function storageError(error, operation) {
    if (error instanceof StageStorageError) return error;
    const name = error && error.name;
    if (name === 'QuotaExceededError') return new StageStorageError('storage.quota', '端末の保存容量が不足しています。バックアップ後に不要なデータを整理してください。');
    return new StageStorageError('storage.failed', operation + 'に失敗しました。', error && error.message);
  }

  class Storage {
    constructor(backend, options) {
      this.backend = backend;
      this.core = resolveCore(options && options.core);
      this.now = options && options.now || (() => Date.now());
      this.pendingAutosaves = new Map();
      this.closed = false;
    }

    ensureOpen() {
      if (this.closed) fail('storage.closed', '端末保存はすでに閉じられています。');
    }

    async put(kind, value, options) {
      this.ensureOpen();
      const store = STORES[kind];
      if (kind === 'custom' && this.core) {
        const rawStage = value && (value.stage || value.document || value);
        if (typeof this.core.validateStage === 'function') {
          const rawValidation = this.core.validateStage(rawStage, { fileSize: options && options.fileSize });
          if (!rawValidation.valid) fail('stage.invalid', '検証に失敗したステージは保存できません。', rawValidation);
        }
        if ((!options || options.verifyHash !== false) && typeof this.core.verifyStageHash === 'function') {
          const rawHashResult = await this.core.verifyStageHash(rawStage);
          const rawHashValid = typeof rawHashResult === 'boolean' ? rawHashResult : !!(rawHashResult && rawHashResult.valid);
          if (!rawHashValid) fail('stage.hash', 'ステージのハッシュが一致しません。', rawHashResult);
        }
      }
      const record = makeRecord(value, kind, this.core, this.now());
      if (kind === 'custom' && this.core) {
        if (typeof this.core.validateStage === 'function') {
          const validation = this.core.validateStage(record.stage, { fileSize: options && options.fileSize });
          if (!validation.valid) fail('stage.invalid', '検証に失敗したステージは保存できません。', validation);
          record.warnings = clone(validation.warnings || []);
        }
        if ((!options || options.verifyHash !== false) && typeof this.core.verifyStageHash === 'function') {
          const hashResult = await this.core.verifyStageHash(record.stage);
          const hashValid = typeof hashResult === 'boolean' ? hashResult : !!(hashResult && hashResult.valid);
          if (!hashValid) fail('stage.hash', 'ステージのハッシュが一致しません。', hashResult);
        }
      }
      try {
        await this.backend.put(store, record);
        return clone(record);
      } catch (error) {
        throw storageError(error, '保存');
      }
    }

    async get(kind, id) {
      this.ensureOpen();
      try {
        const raw = await this.backend.get(STORES[kind], id);
        if (raw == null) return null;
        const migrated = migrateRecord(raw, kind, this.core);
        if (!migrated) fail('record.corrupt', '保存データが壊れているか、対応外の形式です。', { id, kind });
        if (migrated.storageVersion !== raw.storageVersion) await this.backend.put(STORES[kind], migrated);
        return clone(migrated);
      } catch (error) {
        throw storageError(error, '読み込み');
      }
    }

    async list(kind) {
      this.ensureOpen();
      let rows;
      try { rows = await this.backend.getAll(STORES[kind]); }
      catch (error) { throw storageError(error, '一覧の読み込み'); }
      const result = [];
      for (const raw of rows) {
        try {
          const migrated = migrateRecord(raw, kind, this.core);
          if (!migrated) throw new Error('unsupported record');
          result.push(clone(migrated));
          if (migrated.storageVersion !== raw.storageVersion) await this.backend.put(STORES[kind], migrated);
        } catch (error) {
          result.push({
            storageVersion: Number(raw && raw.storageVersion || 0),
            id: String(raw && raw.id || ''),
            kind,
            title: String(raw && raw.title || '壊れた保存データ'),
            updatedAt: raw && raw.updatedAt || null,
            corrupt: true,
            errorCode: error && error.code || 'record.corrupt'
          });
        }
      }
      return result.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    }

    async remove(kind, id) {
      this.ensureOpen();
      try { return await this.backend.delete(STORES[kind], id); }
      catch (error) { throw storageError(error, '削除'); }
    }

    putDraft(value, options) { return this.put('drafts', value, options); }
    getDraft(id) { return this.get('drafts', id); }
    listDrafts() { return this.list('drafts'); }
    deleteDraft(id) { return this.remove('drafts', id); }
    putCustom(value, options) { return this.put('custom', value, options); }
    getCustom(id) { return this.get('custom', id); }
    listCustom() { return this.list('custom'); }
    deleteCustom(id) { return this.remove('custom', id); }

    async renameDraft(id, title) {
      const record = await this.getDraft(id);
      if (!record) return null;
      record.title = String(title || '').trim().slice(0, 80) || 'ステージ';
      record.stage.title = record.title;
      if (record.stage.checksums) record.stage.checksums.contentHash = '';
      return this.putDraft(record);
    }

    async renameCustom(id, displayName) {
      const record = await this.getCustom(id);
      if (!record) return null;
      record.displayName = String(displayName || '').trim().slice(0, 80);
      return this.putCustom(record, { verifyHash: true, fileSize: record.fileSize });
    }

    async duplicateDraft(id, overrides) {
      const source = await this.getDraft(id);
      if (!source) return null;
      const next = clone(source);
      const newId = overrides && overrides.id || (this.core && typeof this.core.randomId === 'function' ? this.core.randomId() : fallbackId());
      const now = normalizeIso(this.now(), Date.now());
      next.id = newId;
      next.stage.stageId = newId;
      next.stage.title = String(overrides && overrides.title || source.stage.title + ' のコピー').slice(0, 80);
      next.title = next.stage.title;
      next.createdAt = now;
      next.updatedAt = now;
      next.stage.createdAt = now;
      next.stage.updatedAt = now;
      if (next.stage.checksums) next.stage.checksums.contentHash = '';
      return this.putDraft(next);
    }

    scheduleAutosave(value, options) {
      this.ensureOpen();
      const id = recordId(value.stage || value.document ? value : { stage: value });
      const delay = Math.max(0, Number(options && options.delayMs == null ? STORAGE_LIMITS.defaultAutosaveDelayMs : options.delayMs));
      let pending = this.pendingAutosaves.get(id);
      if (!pending) pending = { value, waiters: [], timer: null };
      pending.value = clone(value);
      if (pending.timer != null) clearTimeout(pending.timer);
      const promise = new Promise((resolve, reject) => pending.waiters.push({ resolve, reject }));
      pending.timer = setTimeout(() => { this.flushAutosave(id).catch(() => {}); }, delay);
      this.pendingAutosaves.set(id, pending);
      return promise;
    }

    async flushAutosave(id) {
      this.ensureOpen();
      const ids = id == null ? Array.from(this.pendingAutosaves.keys()) : [id];
      const results = [];
      for (const key of ids) {
        const pending = this.pendingAutosaves.get(key);
        if (!pending) continue;
        this.pendingAutosaves.delete(key);
        if (pending.timer != null) clearTimeout(pending.timer);
        try {
          const saved = await this.putDraft(pending.value);
          pending.waiters.forEach((waiter) => waiter.resolve(clone(saved)));
          results.push(saved);
        } catch (error) {
          pending.waiters.forEach((waiter) => waiter.reject(error));
          if (id != null) throw error;
        }
      }
      return id == null ? results : results[0] || null;
    }

    async estimateUsage() {
      this.ensureOpen();
      const rows = (await this.backend.getAll(STORES.drafts)).concat(await this.backend.getAll(STORES.custom));
      const stageStudioUsage = rows.reduce((sum, row) => {
        try { return sum + (Number(row.byteLength) || estimateValueBytes(row)); }
        catch (_) { return sum; }
      }, 0);
      let usage = stageStudioUsage;
      let quota = null;
      let persistent = false;
      const nav = typeof navigator !== 'undefined' ? navigator : null;
      if (nav && nav.storage) {
        if (typeof nav.storage.estimate === 'function') {
          try {
            const estimate = await nav.storage.estimate();
            if (Number.isFinite(estimate.usage)) usage = estimate.usage;
            if (Number.isFinite(estimate.quota)) quota = estimate.quota;
          } catch (_) {}
        }
        if (typeof nav.storage.persisted === 'function') {
          try { persistent = await nav.storage.persisted(); } catch (_) {}
        }
      }
      return Object.freeze({ usage, quota, stageStudioUsage, persistent, backend: this.backend.type, durable: this.backend.durable });
    }

    async clearCorrupt() {
      this.ensureOpen();
      const removed = [];
      for (const kind of ['drafts', 'custom']) {
        const rows = await this.backend.getAll(STORES[kind]);
        for (const row of rows) {
          let valid = true;
          try { valid = !!migrateRecord(row, kind, this.core); } catch (_) { valid = false; }
          if (!valid) {
            await this.backend.delete(STORES[kind], row && row.id);
            removed.push({ id: row && row.id || '', kind });
          }
        }
      }
      return Object.freeze({ count: removed.length, removed });
    }

    async exportSnapshot(kind, id) {
      const normalizedKind = kind === 'custom' ? 'custom' : 'drafts';
      const record = await this.get(normalizedKind, id);
      if (!record) return null;
      const snapshot = clone(record);
      if (typeof Blob !== 'undefined' && snapshot.preview instanceof Blob) {
        snapshot.preview = { omitted: true, mimeType: snapshot.preview.type, byteLength: snapshot.preview.size };
      }
      return JSON.stringify(snapshot);
    }

    async importSnapshot(text, options) {
      let value;
      try { value = JSON.parse(String(text)); }
      catch (_) { fail('snapshot.json', 'バックアップJSONが壊れています。'); }
      const kind = options && options.kind === 'custom' ? 'custom' : (value && value.kind === 'custom' ? 'custom' : 'drafts');
      return kind === 'custom' ? this.putCustom(value, options) : this.putDraft(value, options);
    }

    async close() {
      if (this.closed) return;
      await this.flushAutosave();
      this.closed = true;
      this.backend.close();
    }
  }

  async function open(options) {
    const settings = options || {};
    const dbName = String(settings.dbName || DB_NAME);
    let backend;
    if (!settings.forceMemory && (settings.indexedDB || (typeof indexedDB !== 'undefined' && indexedDB))) {
      try { backend = await openIndexedDb(settings.indexedDB || indexedDB, dbName); }
      catch (error) {
        if (settings.fallbackToMemory === false) throw storageError(error, '端末保存の開始');
      }
    }
    if (!backend) backend = new MemoryBackend(dbName);
    return new Storage(backend, settings);
  }

  let defaultStoragePromise = null;
  function defaultStorage() {
    if (!defaultStoragePromise) defaultStoragePromise = open();
    return defaultStoragePromise;
  }
  const singletonMethod = (name) => async function () {
    const storage = await defaultStorage();
    return storage[name].apply(storage, arguments);
  };

  return Object.freeze({
    DB_NAME,
    DB_VERSION,
    RECORD_VERSION,
    STORES,
    STORAGE_LIMITS,
    StageStorageError,
    estimateValueBytes,
    migrateRecord,
    open,
    putDraft: singletonMethod('putDraft'),
    getDraft: singletonMethod('getDraft'),
    listDrafts: singletonMethod('listDrafts'),
    deleteDraft: singletonMethod('deleteDraft'),
    putCustom: singletonMethod('putCustom'),
    getCustom: singletonMethod('getCustom'),
    listCustom: singletonMethod('listCustom'),
    deleteCustom: singletonMethod('deleteCustom'),
    estimateUsage: singletonMethod('estimateUsage'),
    clearCorrupt: singletonMethod('clearCorrupt')
  });
});
