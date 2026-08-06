'use strict';

let cancelledJob = null;

try {
  importScripts('../../shared/stage-core.js');
} catch (error) {
  self.postMessage({ type: 'worker-error', message: '共通生成モジュールを読み込めませんでした。' });
}

self.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.type === 'cancel') {
    cancelledJob = message.jobId;
    return;
  }
  if (message.type !== 'generate') return;

  const jobId = message.jobId;
  cancelledJob = null;
  self.postMessage({ type: 'progress', jobId, value: 0.1 });

  try {
    if (!self.StageCore || typeof self.StageCore.generateStage !== 'function') {
      throw new Error('共通生成モジュールが利用できません。');
    }
    const stage = self.StageCore.generateStage(Object.assign({}, message.metadata || {}, {
      seed: message.seed,
      preset: message.preset,
      generationParameters: message.parameters
    }));
    if (cancelledJob === jobId) {
      self.postMessage({ type: 'cancelled', jobId });
      return;
    }
    self.postMessage({ type: 'progress', jobId, value: 1 });
    self.postMessage({ type: 'generated', jobId, stage });
  } catch (error) {
    self.postMessage({
      type: 'error',
      jobId,
      message: error instanceof Error ? error.message : '地形を生成できませんでした。'
    });
  }
});
