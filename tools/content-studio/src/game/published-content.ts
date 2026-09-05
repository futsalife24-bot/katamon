import { readBoundedJson } from '../domain/bounded-json';
import { canonicalCharacterRecordSchema, type CanonicalCharacterRecord } from '../generation';
import { LEGACY_CHARACTERS, type LegacyCharacter } from '../domain/legacy-characters';

interface ContentManifest {
  schemaVersion: 1;
  characters: Array<{ contentFile: string; id: string; slug: string; assetDirectory: string }>;
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

export async function loadPublishedContent(fetchImpl: typeof fetch = fetch): Promise<{ records: CanonicalCharacterRecord[]; warning: string | null; state: 'complete' | 'partial' | 'unavailable' }> {
  const records: CanonicalCharacterRecord[] = [];
  try {
    const manifestResponse = await fetchImpl(new URL('generated/content-studio-manifest.json', repositoryRootUrl()), { cache: 'no-store' });
    if (!manifestResponse.ok) throw new Error('公開カタログを読み込めませんでした。');
    const manifest = await readBoundedJson(manifestResponse, 6 * 1024 * 1024) as ContentManifest;
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.characters) || manifest.characters.length > 500) throw new Error('公開カタログの形式が正しくありません。');
    const seen = new Set<string>();
    let incomplete = false;
    for (const item of manifest.characters) {
      try {
      if (!item || typeof item.contentFile !== 'string' || !safeContentPath(item.contentFile) || seen.has(item.contentFile)) throw new Error('公開一覧の参照が不正です。');
      seen.add(item.contentFile);
      const response = await fetchImpl(new URL(item.contentFile, repositoryRootUrl()), { cache: 'no-store' });
      if (!response.ok) throw new Error('公開済みキャラクターデータの一部を読み込めませんでした。');
      const parsed = canonicalCharacterRecordSchema.safeParse(await readBoundedJson(response, 6 * 1024 * 1024));
      if (!parsed.success || item.contentFile !== `content/characters/${parsed.data.character.slug}.json`) throw new Error('公開データの形式が不正です。');
      if (item.id !== parsed.data.character.id || item.slug !== parsed.data.character.slug || item.assetDirectory !== parsed.data.assets.directory) throw new Error('公開一覧と正規データの参照が一致しません。');
      if (records.some(r => r.character.id === parsed.data.character.id)) throw new Error('公開IDが重複しています。');
      records.push(parsed.data as CanonicalCharacterRecord);
      } catch { incomplete = true; }
    }
    return { records, warning: incomplete ? '公開一覧の一部を取得できませんでした。再試行してください。編集とバックアップは続けられます。' : null, state: incomplete ? 'partial' : 'complete' };
  } catch (error) {
    return { records, state: 'unavailable', warning: error instanceof Error ? error.message : '公開カタログを読み込めませんでした。' };
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
