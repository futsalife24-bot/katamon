function toHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function sha256Bytes(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256を利用できない環境です');
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const owned = new Uint8Array(source.byteLength);
  owned.set(source);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', owned.buffer);
  return toHex(new Uint8Array(digest));
}

export async function sha256Text(value: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(value));
}

export async function sha256Blob(value: Blob): Promise<string> {
  return sha256Bytes(await value.arrayBuffer());
}
