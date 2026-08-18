/// <reference lib="webworker" />

import { generateIdleSpriteSheet } from './generator';
import type { MotionWorkerRequest, MotionWorkerResponse } from './worker-protocol';

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = async (event: MessageEvent<MotionWorkerRequest>) => {
  const message = event.data;
  if (message.type !== 'generate') return;
  try {
    const result = await generateIdleSpriteSheet(
      message.request,
      {
        onProgress: (progress) => {
          const response: MotionWorkerResponse = { id: message.id, type: 'progress', progress };
          workerScope.postMessage(response);
        },
      },
      true,
    );
    const response: MotionWorkerResponse = { id: message.id, type: 'complete', result };
    workerScope.postMessage(response, [result.sheet.data.buffer]);
  } catch (error) {
    const value = error as Error;
    const response: MotionWorkerResponse = {
      id: message.id,
      type: 'error',
      error: { name: value.name || 'Error', message: value.message || 'モーション生成に失敗しました。' },
    };
    workerScope.postMessage(response);
  }
};
