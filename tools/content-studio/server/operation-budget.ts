import { AsyncLocalStorage } from 'node:async_hooks';
import { HttpError } from './security.js';
import type { FetchLike } from './types.js';

export const operationContext = new AsyncLocalStorage<AbortSignal>();
export function assertOperationActive(): void {
  if (operationContext.getStore()?.aborted) throw new HttpError(504, 'operation_expired', '処理の確認期限を超えました。書込結果は既存PRから再確認してください。');
}

/** Admission includes response consumption and non-cooperative work after timeout. No unbounded queue. */
export function boundedGitHubFetch(fetchImpl: FetchLike, maxBytes: number, timeoutMs = 15_000, maxActive = 4): FetchLike {
  let active = 0;
  return async (input, init = {}) => {
    assertOperationActive();
    if (active >= maxActive) throw new HttpError(503, 'github_busy', 'GitHub通信が混み合っています。保存物を保持して再試行してください。');
    active++;
    const controller = new AbortController();
    const signals = [controller.signal, init.signal, operationContext.getStore()].filter(Boolean) as AbortSignal[];
    const signal = AbortSignal.any(signals);
    let rejectDeadline: (reason: unknown) => void = () => {};
    const expired = new Promise<never>((_, reject) => { rejectDeadline = reject; });
    const abort = () => rejectDeadline(new HttpError(504, 'github_timeout', 'GitHub応答の確認期限を超えました。送信済み書込の取消は保証されません。既存PRを再確認してください。'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const work = (async () => {
      try {
        if(signal.aborted)throw new Error('expired');
        const response = await fetchImpl(input, { ...init, signal, redirect: 'error' });
        const length = Number(response.headers.get('content-length'));
        if (length > maxBytes) { await response.body?.cancel(); throw new Error('limit'); }
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = []; let size = 0;
        if (reader) try {
          for (;;) {
            if (signal.aborted) throw new Error('expired');
            const {done,value} = await reader.read(); if (done) break;
            size += value.byteLength; if (size > maxBytes) throw new Error('limit'); chunks.push(value);
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        if (signal.aborted) throw new Error('expired');
        const headers = new Headers(response.headers); headers.delete('content-encoding'); headers.set('content-length', String(size));
        return new Response(size ? Buffer.concat(chunks) : null, {status:response.status, statusText:response.statusText, headers});
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(502, 'github_transport_failed', 'GitHub通信または応答容量を確認できませんでした。保存物を保持して停止しました。');
      } finally { active--; clearTimeout(timer); signal.removeEventListener('abort', abort); }
    })();
    return Promise.race([work, expired]);
  };
}
