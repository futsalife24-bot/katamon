export interface Capabilities {
  worker: boolean;
  offscreenCanvas: boolean;
  createImageBitmap: boolean;
  webShare: boolean;
  shareFiles: boolean;
  wakeLock: boolean;
  storageEstimate: boolean;
  persistentStorage: boolean;
  visualViewport: boolean;
  online: boolean;
  installPrompt: boolean;
}

export function detectCapabilities(): Capabilities {
  const canShareFiles = typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
  return {
    worker: typeof Worker !== 'undefined',
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    createImageBitmap: typeof createImageBitmap === 'function',
    webShare: typeof navigator.share === 'function',
    shareFiles: canShareFiles,
    wakeLock: 'wakeLock' in navigator,
    storageEstimate: Boolean(navigator.storage?.estimate),
    persistentStorage: Boolean(navigator.storage?.persist),
    visualViewport: Boolean(window.visualViewport),
    online: navigator.onLine,
    installPrompt: false,
  };
}

export async function requestPersistentStorage(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null;
  return navigator.storage.persist();
}

export async function storageUsage(): Promise<{ usage: number; quota: number; ratio: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const estimate = await navigator.storage.estimate();
  const usage = estimate.usage ?? 0;
  const quota = estimate.quota ?? 0;
  return { usage, quota, ratio: quota > 0 ? usage / quota : 0 };
}

export async function acquireWakeLock(): Promise<{ release(): Promise<void> } | null> {
  if (!('wakeLock' in navigator)) return null;
  try {
    return await navigator.wakeLock.request('screen');
  } catch {
    return null;
  }
}

export async function shareFiles(files: File[], title: string, text: string): Promise<'shared' | 'unsupported' | 'cancelled'> {
  if (!navigator.share || !navigator.canShare?.({ files })) return 'unsupported';
  try {
    await navigator.share({ files, title, text });
    return 'shared';
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'unsupported';
  }
}
