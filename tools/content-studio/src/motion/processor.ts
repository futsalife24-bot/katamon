import { generateIdleSpriteSheet } from './generator';
import { makeLightweightMotionParameters, resolveMotionParameters } from './presets';
import type { IdleSpriteResult, MotionControl, MotionGenerationRequest } from './types';
import type { MotionWorkerRequest, MotionWorkerResponse } from './worker-protocol';

type WorkerFactory = () => Worker;

class MotionWorkerExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MotionWorkerExecutionError';
  }
}

export function supportsMotionWorker(): boolean {
  return typeof Worker !== 'undefined';
}

export class ContentMotionProcessor {
  constructor(
    private readonly workerFactory: WorkerFactory = () => new Worker(new URL('./motion.worker.ts', import.meta.url), { type: 'module' }),
  ) {}

  async generate(request: MotionGenerationRequest, control: MotionControl = {}): Promise<IdleSpriteResult> {
    if (supportsMotionWorker()) {
      try {
        return await this.generateInWorker(request, control);
      } catch (error) {
        if (control.signal?.aborted) throw error;
        if (!(error instanceof MotionWorkerExecutionError)) throw error;
      }
    }
    const resolved = resolveMotionParameters(request.preset, request.parameters);
    const fallback = makeLightweightMotionParameters(resolved);
    return generateIdleSpriteSheet(
      { ...request, parameters: fallback },
      { ...control, yieldToMainThread: true },
      false,
    );
  }

  private generateInWorker(request: MotionGenerationRequest, control: MotionControl): Promise<IdleSpriteResult> {
    return new Promise((resolve, reject) => {
      let worker: Worker;
      try {
        worker = this.workerFactory();
      } catch (error) {
        reject(new MotionWorkerExecutionError(error instanceof Error ? error.message : 'Workerを開始できませんでした。'));
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
      const abort = () => finish(() => reject(new DOMException('モーション生成を中止しました。', 'AbortError')));
      control.signal?.addEventListener('abort', abort, { once: true });
      if (control.signal?.aborted) {
        abort();
        return;
      }
      worker.onmessage = (event: MessageEvent<MotionWorkerResponse>) => {
        const message = event.data;
        if (message.id !== id) return;
        if (message.type === 'progress') control.onProgress?.(message.progress);
        else if (message.type === 'complete') finish(() => resolve(message.result));
        else {
          const remoteError = new Error(message.error.message);
          remoteError.name = message.error.name;
          finish(() => reject(remoteError));
        }
      };
      worker.onerror = (event) => finish(() => reject(new MotionWorkerExecutionError(event.message || 'Worker生成に失敗しました。')));
      // Clone before transfer so the editor keeps its normalized source pixels.
      const source = {
        ...request.source,
        data: new Uint8ClampedArray(request.source.data),
      };
      const message: MotionWorkerRequest = { id, type: 'generate', request: { ...request, source } };
      worker.postMessage(message, [source.data.buffer]);
    });
  }
}
