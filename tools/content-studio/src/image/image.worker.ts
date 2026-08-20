/// <reference lib="webworker" />

import { processImageCore } from './core';
import type { ImageWorkerRequest, ImageWorkerResponse } from './worker-protocol';

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = async (event: MessageEvent<ImageWorkerRequest>) => {
  const message = event.data;
  if (message.type !== 'process') return;
  try {
    const result = await processImageCore(
      message.request,
      {
        onProgress: (progress) => {
          const response: ImageWorkerResponse = { id: message.id, type: 'progress', progress };
          workerScope.postMessage(response);
        },
      },
      3072,
      true,
    );
    const response: ImageWorkerResponse = { id: message.id, type: 'complete', result };
    const transfers: Transferable[] = [
      result.original.data.buffer,
      result.edited.data.buffer,
      result.normalized.pixels.data.buffer,
    ];
    workerScope.postMessage(response, transfers);
  } catch (error) {
    const value = error as Error & { code?: string };
    const response: ImageWorkerResponse = {
      id: message.id,
      type: 'error',
      error: { name: value.name || 'Error', message: value.message || '画像処理に失敗しました。', code: value.code },
    };
    workerScope.postMessage(response);
  }
};
