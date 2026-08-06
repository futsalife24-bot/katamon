(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StageRepository = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  class StageRepositoryError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = 'StageRepositoryError';
      this.code = code;
      if (details !== undefined) this.details = details;
    }
  }

  function unavailable(method) {
    throw new StageRepositoryError(
      'repository.notImplemented',
      method + 'はこのステージ保存先で利用できません。'
    );
  }

  function resolveStorageModule(provided) {
    if (provided) return provided;
    if (root && root.StageStorage) return root.StageStorage;
    if (typeof require === 'function') {
      try { return require('./stage-storage.js'); } catch (_) { return null; }
    }
    return null;
  }

  class StageRepositoryProvider {
    constructor(options) {
      const settings = options || {};
      Object.defineProperties(this, {
        providerId: {
          value: String(settings.providerId || 'stage-repository'),
          enumerable: true
        },
        network: {
          value: settings.network === true,
          enumerable: true
        }
      });
    }

    saveStage() { return unavailable('saveStage'); }
    getStage() { return unavailable('getStage'); }
    listStages() { return unavailable('listStages'); }
    deleteStage() { return unavailable('deleteStage'); }
    renameStage() { return unavailable('renameStage'); }

    // StageStorageを直接使っていた既存UI向けの互換名。
    putCustom(value, options) { return this.saveStage(value, options); }
    getCustom(id) { return this.getStage(id); }
    listCustom(options) { return this.listStages(options); }
    deleteCustom(id) { return this.deleteStage(id); }
    renameCustom(id, displayName) { return this.renameStage(id, displayName); }
  }

  class LocalStageRepositoryProvider extends StageRepositoryProvider {
    constructor(options) {
      const settings = options || {};
      super({ providerId: settings.providerId || 'local-device', network: false });
      this.storageModule = resolveStorageModule(settings.storageModule);
      this.providedStorage = settings.storage || null;
      this.openOptions = settings.openOptions || {};
      this.storagePromise = null;
      this.capabilities = Object.freeze({
        create: true,
        read: true,
        update: true,
        delete: true,
        network: false
      });
    }

    async storage() {
      if (!this.storagePromise) {
        if (this.providedStorage) {
          this.storagePromise = Promise.resolve(this.providedStorage);
        } else if (this.storageModule && typeof this.storageModule.open === 'function') {
          this.storagePromise = Promise.resolve(this.storageModule.open(this.openOptions));
        } else {
          this.storagePromise = Promise.reject(new StageRepositoryError(
            'repository.storageUnavailable',
            '端末内のステージ保存領域を開けません。'
          ));
        }
      }
      const storage = await this.storagePromise;
      const required = ['putCustom', 'getCustom', 'listCustom', 'deleteCustom'];
      if (!storage || required.some((method) => typeof storage[method] !== 'function')) {
        throw new StageRepositoryError(
          'repository.storageContract',
          '端末保存の機能が不足しています。'
        );
      }
      return storage;
    }

    async ready() {
      await this.storage();
      return this;
    }

    async saveStage(value, options) {
      const storage = await this.storage();
      return storage.putCustom(value, options);
    }

    async getStage(id) {
      const storage = await this.storage();
      return storage.getCustom(id);
    }

    async listStages() {
      const storage = await this.storage();
      return storage.listCustom();
    }

    async deleteStage(id) {
      const storage = await this.storage();
      return storage.deleteCustom(id);
    }

    async renameStage(id, displayName) {
      const storage = await this.storage();
      if (typeof storage.renameCustom !== 'function') return unavailable('renameStage');
      return storage.renameCustom(id, displayName);
    }
  }

  function createLocalProvider(options) {
    return new LocalStageRepositoryProvider(options);
  }

  return Object.freeze({
    StageRepositoryError,
    StageRepositoryProvider,
    LocalStageRepositoryProvider,
    createLocalProvider
  });
});
