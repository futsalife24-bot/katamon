import { parseBoundedJson } from '../src/domain/bounded-json.js';
import { createHash } from 'node:crypto';
import { buildCompatibilityCatalog, buildContentManifest, canonicalCharacterRecordSchema, serializeCompatibilityCatalog, type CanonicalCharacterRecord } from '../src/generation/catalog.js';
import { stableStringify } from '../src/generation/stable.js';
import { HttpError } from './security.js';
import { validateCheckpointPng, validateImage, validateSubmittedFile } from './validation.js';
import type { GitTreeEntry, ServerConfig, ValidatedBundle, ValidatedFile } from './types.js';

export const AGGREGATES = ['generated/content-studio-catalog.js', 'generated/content-studio-manifest.json'] as const;
export function trustedFile(path: string, mimeType: string, bytes: Buffer): ValidatedFile {
  return { path, mimeType, bytes, sha256: createHash('sha256').update(bytes).digest('hex'), gitBlobSha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') };
}
export function fileDigest(files: readonly ValidatedFile[]): string {
  return createHash('sha256').update(JSON.stringify([...files].sort((a,b) => a.path.localeCompare(b.path, 'en')).map(f => [f.path, f.gitBlobSha]))).digest('hex');
}
function deny(message: string): never { throw new HttpError(409, 'snapshot_invalid', message); }
function parseRecord(bytes: Buffer, path: string): CanonicalCharacterRecord {
  try {
    const record = canonicalCharacterRecordSchema.parse(parseBoundedJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes))) as CanonicalCharacterRecord;
    if (path !== `content/characters/${record.character.slug}.json`) deny('正規ファイル名とslugが一致しません。');
    return record;
  } catch { return deny('正規キャラクターデータを安全に照合できません。'); }
}

/** Browser aggregates are optional claims only. The committed set always comes from this fixed tree. */
export async function reconstructSnapshot(bundle: ValidatedBundle, tree: GitTreeEntry[], getBlob: (sha: string) => Promise<Buffer>, config: ServerConfig): Promise<ValidatedFile[]> {
  const entries = new Map<string, GitTreeEntry>();
  const folded = new Set<string>();
  for (const entry of tree) {
    if (folded.has(entry.path.toLowerCase())) deny('基準ツリーに重複または大小文字の衝突があります。');
    folded.add(entry.path.toLowerCase());
    entries.set(entry.path, entry);
  }
  const submitted = new Map(bundle.files.map(f => [f.path, f]));
  const targetPath = `content/characters/${bundle.character.slug}.json`;
  const targetFile = submitted.get(targetPath);
  if (!targetFile) deny('更新対象の正規データがありません。');
  const target = parseRecord(targetFile.bytes, targetPath);
  const canonicals = tree.filter(e => e.path.startsWith('content/characters/') && /\.json$/i.test(e.path));
  if (canonicals.length > 500) deny('正規キャラクター数が検証上限を超えています。');
  let readBytes = 0;
  const cache = new Map<string, Buffer>();
  const read = async (path: string): Promise<Buffer> => {
    const entry = entries.get(path);
    if (!entry || entry.type !== 'blob' || entry.mode !== '100644' || (entry.size ?? 0) > config.maxFileBytes) deny('参照ファイルが基準ツリーに存在しないか、安全に読めません。');
    if (cache.has(entry.sha)) return cache.get(entry.sha)!;
    const bytes = await getBlob(entry.sha);
    readBytes += bytes.length;
    // Bound the complete reference audit, independent of client upload limits.
    if (bytes.length > config.maxFileBytes || readBytes > 256 * 1024 * 1024) deny('基準snapshotが安全な検証容量を超えています。');
    if (trustedFile(path, '', bytes).gitBlobSha !== entry.sha) deny('基準ファイルのGitハッシュが一致しません。');
    cache.set(entry.sha, bytes);
    return bytes;
  };
  const records: CanonicalCharacterRecord[] = [];
  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const entry of canonicals) {
    const record = parseRecord(await read(entry.path), entry.path);
    const id = record.character.id.toLowerCase();
    const slug = record.character.slug.toLowerCase();
    if (ids.has(id) || slugs.has(slug)) deny('基準snapshotのIDまたはslugが重複しています。');
    ids.add(id); slugs.add(slug);
    if (entry.path === targetPath) {
      if (record.character.id !== target.character.id || record.legacyTargetId !== target.legacyTargetId) deny('更新対象のidentityを変更できません。');
      if(record.legacyTargetId && stableStringify({...record.character,sourceFacesLeft:target.character.sourceFacesLeft})!==stableStringify(target.character))deny('既存キャラの非モーション設定は変更できません。');
    } else {
      if (id === target.character.id.toLowerCase() || slug === target.character.slug.toLowerCase()) deny('既存のIDまたはslugと衝突しています。');
      records.push(record);
    }
  }
  records.push(target);
  const allowed = new Set<string>([targetPath, ...AGGREGATES]);
  for (const record of records) {
    const paths: string[] = [];
    for (const [key, value] of Object.entries(record.assets)) {
      if (key === 'directory') continue;
      if (typeof value === 'string') paths.push(value);
      else if (value) paths.push(...Object.values(value) as string[]);
    }
    for (const path of new Set(paths)) {
      if (!path.startsWith(`${record.assets.directory}/`)) deny('他キャラクターの画像を参照できません。');
      if (record === target) allowed.add(path);
      const upload = record === target ? submitted.get(path) : undefined;
      const bytes = upload?.bytes ?? await read(path);
      const mimeType = path.endsWith('.json') ? 'application/json' : path.endsWith('.webp') ? 'image/webp' : path.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
      const file = trustedFile(path, mimeType, bytes);
      validateSubmittedFile({ ...file, byteLength: bytes.length, contentBase64: bytes.toString('base64') }, record.character.slug, config);
      if (record.editing && (path===record.assets.editSourcePng || path===record.assets.editHitPng)) {
        validateCheckpointPng(bytes,path===record.assets.editSourcePng?record.editing.source:record.editing.hitSource!,config);
      }
      if (path.endsWith('.png')) {
        const clip = Object.entries(record.assets.motionSpriteSheets ?? {}).find(([,p]) => p === path)?.[0];
        const metadata = clip ? record.motionMetadata?.[clip as keyof NonNullable<typeof record.motionMetadata>] : path === record.assets.spriteSheetPng ? record.spriteMetadata : undefined;
        if (metadata) {
          const dimensions = validateImage(bytes, mimeType, config);
          if (dimensions.width !== metadata.frameWidth * metadata.frameCount || dimensions.height !== metadata.frameHeight) deny('スプライト画像の寸法とmetadataが一致しません。');
        }
      }
      if (path.endsWith('.json')) {
        const clip = Object.entries(record.assets.motionMetadataJson ?? {}).find(([,p]) => p === path)?.[0];
        const metadata = clip ? record.motionMetadata?.[clip as keyof NonNullable<typeof record.motionMetadata>] : record.spriteMetadata;
        if (stableStringify(JSON.parse(bytes.toString('utf8'))) !== stableStringify(metadata)) deny('canonicalとmotion metadataの内容が一致しません。');
      }
    }
  }
  for (const file of bundle.files) {
    if (!allowed.has(file.path)) deny('対象外のファイル変更は許可されていません。');
    const existing = entries.get(file.path);
    if (file.path.startsWith('assets/content-studio/') && existing && existing.sha !== file.gitBlobSha) deny('既存ハッシュ付き画像は上書きできません。');
    if ([...entries.keys()].some(p => p.toLowerCase() === file.path.toLowerCase() && p !== file.path)) deny('ファイル名の大小文字が衝突しています。');
  }
  const aggregates = [
    trustedFile(AGGREGATES[0], 'text/javascript', Buffer.from(serializeCompatibilityCatalog(buildCompatibilityCatalog(records)))),
    trustedFile(AGGREGATES[1], 'application/json', Buffer.from(buildContentManifest(records))),
  ];
  for (const expected of aggregates) {
    const claim = submitted.get(expected.path);
    if (claim && !claim.bytes.equals(expected.bytes)) deny('提出された全体カタログが基準snapshotと一致しません。GitHubのsnapshotで再準備してください。');
  }
  const files = [...bundle.files.filter(f => !AGGREGATES.includes(f.path as typeof AGGREGATES[number])), ...aggregates];
  if (files.length > config.maxFiles || files.some(f => f.bytes.length > config.maxFileBytes) || files.reduce((n,f) => n + f.bytes.length, 0) > config.maxTotalFileBytes) deny('再構成後の公開容量が上限を超えています。');
  return files;
}
