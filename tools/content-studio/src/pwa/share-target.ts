const DB_NAME = 'content-studio-share-v1';
const STORE_NAME = 'shares';

function openShareDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('共有画像を開けませんでした。'));
  });
}

export async function consumeSharedImage(id: string): Promise<File | null> {
  if (!id || id.length > 80 || !/^[a-zA-Z0-9-]+$/.test(id)) return null;
  const db = await openShareDb();
  const record = await new Promise<{ id: string; file: File } | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result as { id: string; file: File } | undefined);
    request.onerror = () => reject(request.error ?? new Error('共有画像を読み込めませんでした。'));
  });
  db.close();
  navigator.serviceWorker?.controller?.postMessage({ type: 'DELETE_SHARED_FILE', id });
  return record?.file ?? null;
}
