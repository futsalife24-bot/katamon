import { canonicalCharacterRecordSchema, type CanonicalCharacterRecord } from '../generation';
import { LEGACY_CHARACTERS, type LegacyCharacter } from '../domain/legacy-characters';

interface ContentManifest {
  schemaVersion: 1;
  characters: Array<{ contentFile: string }>;
}

function repositoryRootUrl(): URL {
  const marker = '/tools/content-studio/';
  const index = location.pathname.indexOf(marker);
  const path = index >= 0 ? location.pathname.slice(0, index + 1) : '/';
  return new URL(path, location.origin);
}

function safeContentPath(value: string): boolean {
  return /^content\/characters\/[a-z][a-z0-9-]{0,23}\.json$/u.test(value);
}

export function publishedAssetUrl(path: string): URL {
  if (!/^assets\/content-studio\/[a-z][a-z0-9-]{0,23}\/[a-f0-9]{12}\/[a-z0-9.-]+$/u.test(path) || path.includes('..')) {
    throw new Error('公開済み画像の参照先が安全ではありません。');
  }
  return new URL(path, repositoryRootUrl());
}

export async function loadPublishedContent(fetchImpl: typeof fetch = fetch): Promise<{ records: CanonicalCharacterRecord[]; warning: string | null }> {
  try {
    const manifestResponse = await fetchImpl(new URL('generated/content-studio-manifest.json', repositoryRootUrl()), { cache: 'no-store' });
    if (manifestResponse.status === 404) return { records: [], warning: null };
    if (!manifestResponse.ok) throw new Error('公開カタログを読み込めませんでした。');
    const manifest = await manifestResponse.json() as ContentManifest;
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.characters)) throw new Error('公開カタログの形式が正しくありません。');
    const records: CanonicalCharacterRecord[] = [];
    for (const item of manifest.characters) {
      if (!item || typeof item.contentFile !== 'string' || !safeContentPath(item.contentFile)) continue;
      const response = await fetchImpl(new URL(item.contentFile, repositoryRootUrl()), { cache: 'no-store' });
      if (!response.ok) throw new Error('公開済みキャラクターデータの一部を読み込めませんでした。');
      const parsed = canonicalCharacterRecordSchema.safeParse(await response.json());
      if (parsed.success) records.push(parsed.data as CanonicalCharacterRecord);
    }
    return { records, warning: null };
  } catch (error) {
    return { records: [], warning: error instanceof Error ? error.message : '公開カタログを読み込めませんでした。' };
  }
}

export async function fetchPublishedImage(record: CanonicalCharacterRecord, fetchImpl: typeof fetch = fetch): Promise<File> {
  const response = await fetchImpl(publishedAssetUrl(record.assets.normalizedPng), { cache: 'no-store' });
  if (!response.ok) throw new Error('公開済み画像を読み込めませんでした。');
  const blob = await response.blob();
  if (blob.type !== 'image/png' || blob.size === 0 || blob.size > 20 * 1024 * 1024) throw new Error('公開済み画像の形式または容量が正しくありません。');
  return new File([blob], `${record.character.slug}.png`, { type: 'image/png', lastModified: Date.now() });
}

export async function fetchLegacyImage(record: LegacyCharacter, fetchImpl: typeof fetch = fetch): Promise<File> {
  if (!LEGACY_CHARACTERS.some(({ id, asset }) => id === record.id && asset === record.asset)) {
    throw new Error('既存キャラクターの画像参照が安全ではありません。');
  }
  for (const extension of ['webp', 'png'] as const) {
    const directory = extension === 'webp' ? 'runtime' : 'master';
    const response = await fetchImpl(new URL(`assets/characters/${directory}/${record.asset}.${extension}`, repositoryRootUrl()), { cache: 'no-store' });
    if (response.status === 404) continue;
    if (!response.ok) throw new Error('既存キャラクター画像を読み込めませんでした。');
    const blob = await response.blob();
    const mimeType = extension === 'webp' ? 'image/webp' : 'image/png';
    if (blob.size === 0 || blob.size > 20 * 1024 * 1024) throw new Error('既存キャラクター画像の容量が正しくありません。');
    return new File([blob], `${record.slug}.${extension}`, { type: mimeType, lastModified: Date.now() });
  }
  throw new Error('既存キャラクター画像が見つかりませんでした。');
}
