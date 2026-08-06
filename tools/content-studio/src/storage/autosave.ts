import type { DraftRecord } from '../domain/types';
import { saveDraft } from './db';

export interface AutosaveController {
  schedule(record: DraftRecord): void;
  flush(): Promise<DraftRecord | null>;
  cancel(): void;
}

export function createAutosaveController(
  delayMs: number,
  onSaved: (saved: DraftRecord) => void,
  onError: (error: Error) => void,
): AutosaveController {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: DraftRecord | null = null;
  let chain: Promise<DraftRecord | null> = Promise.resolve(null);

  const persist = (): Promise<DraftRecord | null> => {
    if (!pending) return chain;
    const next = pending;
    pending = null;
    if (timer) clearTimeout(timer);
    timer = null;
    chain = chain.then(async () => {
      try {
        const saved = await saveDraft(next);
        onSaved(saved);
        return saved;
      } catch (error) {
        onError(error instanceof Error ? error : new Error('下書きを保存できませんでした。'));
        return null;
      }
    });
    return chain;
  };

  return {
    schedule(record) {
      pending = structuredClone(record);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void persist(), delayMs);
    },
    flush: persist,
    cancel() {
      pending = null;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
