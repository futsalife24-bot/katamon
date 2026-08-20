import { processImageCore } from './core';
import { MAIN_THREAD_DECODE_MAX_DIMENSION } from './header';
import type { ProcessControl, ProcessedImage, ProcessImageRequest } from './types';
import type { ImageWorkerRequest, ImageWorkerResponse } from './worker-protocol';

type WorkerFactory = () => Worker;

class WorkerExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerExecutionError';
  }
}

export function supportsWorkerImageProcessing(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function';
}

export class ContentImageProcessor {
  constructor(
    private readonly workerFactory: WorkerFactory = () => new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' }),
  ) {}

  async process(request: ProcessImageRequest, control: ProcessControl = {}): Promise<ProcessedImage> {
    if (supportsWorkerImageProcessing()) {
      try {
        return await this.processInWorker(request, control);
      } catch (error) {
        if (control.signal?.aborted) throw error;
        if (!(error instanceof WorkerExecutionError)) throw error;
        control.onProgress?.({
          stage: 'decode',
          progress: 0,
          message: '端末の互換モードへ切り替え、低解像度で再試行します',
        });
      }
    }
    return processImageCore(request, control, MAIN_THREAD_DECODE_MAX_DIMENSION, false);
  }

  private processInWorker(request: ProcessImageRequest, control: ProcessControl): Promise<ProcessedImage> {
    return new Promise<ProcessedImage>((resolve, reject) => {
      let worker: Worker;
      try {
        worker = this.workerFactory();
      } catch (error) {
        reject(new WorkerExecutionError(error instanceof Error ? error.message : 'Workerを開始できませんでした。'));
        return;
      }
      const id = crypto.randomUUID();
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        control.signal?.removeEventListener('abort', abort);
        worker.terminate();
        callback();
      };
      const abort = () => finish(() => reject(new DOMException('画像処理を中止しました。', 'AbortError')));
      control.signal?.addEventListener('abort', abort, { once: true });
      if (control.signal?.aborted) {
        abort();
        return;
      }
      worker.onmessage = (event: MessageEvent<ImageWorkerResponse>) => {
        const message = event.data;
        if (message.id !== id) return;
        if (message.type === 'progress') control.onProgress?.(message.progress);
        else if (message.type === 'complete') finish(() => resolve(message.result));
        else {
          const remoteError = new Error(message.error.message);
          remoteError.name = message.error.name;
          Object.assign(remoteError, { code: message.error.code });
          finish(() => reject(remoteError));
        }
      };
      worker.onerror = (event) => finish(() => reject(new WorkerExecutionError(event.message || 'Worker画像処理に失敗しました。')));
      const message: ImageWorkerRequest = { id, type: 'process', request };
      worker.postMessage(message);
    });
  }
}
