import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ArtifactBundle, DraftRecord, PullRequestResult } from '../domain/types';
import type { CharacterAssetVersionRecord, CharacterIdentityRecord, CharacterRevisionRecord } from '../domain/character-db';
import { createInitialCharacterRecords } from '../domain/character-db';
import type { AiProposal } from '../domain/ai-proposal';
import { validateAiProposal } from '../domain/ai-proposal';
import { createDraft } from '../domain/defaults';
import { DRAFT_SCHEMA_VERSION } from '../domain/types';

export type DraftBlobKind =
  | 'original'
  | 'hit-original'
  | 'working'
  | 'normalized'
  | 'optimized'
  | 'mask'
  | 'sprite'
  | 'motion-move-forward'
  | 'motion-move-backward'
  | 'motion-fire'
  | 'motion-hit'
  | 'motion-land'
  | 'icon'
  | 'thumbnail'
  | 'preview';

interface StoredBlob {
  key: string;
  draftId: string;
  kind: DraftBlobKind;
  blob: Blob;
  sha256: string;
  updatedAt: string;
}

export interface OutboxRecord {
  id: string;
  draftId: string;
  bundle: ArtifactBundle;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  lastError: string | null;
}

export interface PublishHistoryRecord {
  id: string;
  draftId: string;
  characterId: string;
  displayName: string;
  completedAt: string;
  result: PullRequestResult;
}

interface AppMetaRecord {
  key: string;
  value: unknown;
}

interface StudioDbSchema extends DBSchema {
  aiProposals: { key: string; value: AiProposal; indexes: { 'by-created-at': string } };
  characterRecords: { key: string; value: CharacterIdentityRecord; indexes: { 'by-updated-at': string; 'by-slug': string } };
  characterAssets: { key: string; value: CharacterAssetVersionRecord; indexes: { 'by-character': string; 'by-created-at': string } };
  characterRevisions: { key: string; value: CharacterRevisionRecord; indexes: { 'by-character': string; 'by-created-at': string } };
  drafts: {
    key: string;
    value: DraftRecord;
    indexes: { 'by-updated-at': string };
  };
  blobs: {
    key: string;
    value: StoredBlob;
    indexes: { 'by-draft': string; 'by-kind': DraftBlobKind };
  };
  outbox: {
    key: string;
    value: OutboxRecord;
    indexes: { 'by-updated-at': string };
  };
  history: {
    key: string;
    value: PublishHistoryRecord;
    indexes: { 'by-completed-at': string };
  };
  appMeta: {
    key: string;
    value: AppMetaRecord;
  };
}

const DB_NAME = 'content-studio-v1';
const DB_VERSION = 2;
let dbPromise: Promise<IDBPDatabase<StudioDbSchema>> | null = null;

function openStudioDb(): Promise<IDBPDatabase<StudioDbSchema>> {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('この端末では下書き保存を利用できません。'));
  if (!dbPromise) {
    dbPromise = openDB<StudioDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('aiProposals')) {
          const store = db.createObjectStore('aiProposals', { keyPath: 'proposalId' });
          store.createIndex('by-created-at', 'createdAt');
        }
        if (!db.objectStoreNames.contains('characterRecords')) {
          const store = db.createObjectStore('characterRecords', { keyPath: 'characterId' });
          store.createIndex('by-updated-at', 'updatedAt');
          store.createIndex('by-slug', 'slug');
        }
        if (!db.objectStoreNames.contains('characterAssets')) {
          const store = db.createObjectStore('characterAssets', { keyPath: 'id' });
          store.createIndex('by-character', 'characterId');
          store.createIndex('by-created-at', 'createdAt');
        }
        if (!db.objectStoreNames.contains('characterRevisions')) {
          const store = db.createObjectStore('characterRevisions', { keyPath: 'id' });
          store.createIndex('by-character', 'characterId');
          store.createIndex('by-created-at', 'createdAt');
        }
        if (!db.objectStoreNames.contains('drafts')) {
          const store = db.createObjectStore('drafts', { keyPath: 'id' });
          store.createIndex('by-updated-at', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('blobs')) {
          const store = db.createObjectStore('blobs', { keyPath: 'key' });
          store.createIndex('by-draft', 'draftId');
          store.createIndex('by-kind', 'kind');
        }
        if (!db.objectStoreNames.contains('outbox')) {
          const store = db.createObjectStore('outbox', { keyPath: 'id' });
          store.createIndex('by-updated-at', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('history')) {
          const store = db.createObjectStore('history', { keyPath: 'id' });
          store.createIndex('by-completed-at', 'completedAt');
        }
        if (!db.objectStoreNames.contains('appMeta')) db.createObjectStore('appMeta', { keyPath: 'key' });
      },
      blocked() {
        window.dispatchEvent(new CustomEvent('studio-storage-blocked'));
      },
      blocking() {
        dbPromise = null;
      },
      terminated() {
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

export async function saveAiProposal(proposal: AiProposal): Promise<void> {
  const db = await openStudioDb();
  await db.put('aiProposals', structuredClone(proposal));
}

export async function listAiProposals(): Promise<AiProposal[]> {
  const db = await openStudioDb();
  return (await db.getAllFromIndex('aiProposals', 'by-created-at')).reverse();
}

export async function importAiProposalJson(file: Blob, current?: { characterId: string; revision: number }): Promise<ReturnType<typeof validateAiProposal>> {
  if (file.size > 256 * 1024) throw new Error('AI提案JSONは256KB以下にしてください。');
  let raw: unknown;
  try { raw = JSON.parse(await file.text()); } catch { throw new Error('AI提案JSONを読み込めませんでした。'); }
  const result = validateAiProposal(raw, current);
  if (result.proposal && result.errors.length === 0) await saveAiProposal(result.proposal);
  return result;
}

export async function seedCharacterDatabase(): Promise<CharacterIdentityRecord[]> {
  const db = await openStudioDb();
  const existing = await db.getAll('characterRecords');
  if (existing.length > 0) return existing;
  const records = createInitialCharacterRecords();
  const tx = db.transaction(['characterRecords', 'characterRevisions', 'characterAssets'], 'readwrite');
  for (const record of records) {
    await tx.objectStore('characterRecords').put(record);
    await tx.objectStore('characterRevisions').put({
      id: `${record.characterId}:r1`, characterId: record.characterId, revision: 1, reason: 'import',
      changedFields: ['initial-import'], snapshot: structuredClone(record) as unknown as Record<string, unknown>, createdAt: record.createdAt,
    });
    await tx.objectStore('characterAssets').put({
      id: `${record.characterId}:source-image:v1`, characterId: record.characterId, kind: 'source-image',
      sourceRef: `legacy://${record.assetKey}`, contentHash: null, version: 1, status: 'needs-review', createdAt: record.createdAt,
    });
  }
  await tx.done;
  return records;
}

export async function listCharacterRecords(): Promise<CharacterIdentityRecord[]> {
  const db = await openStudioDb();
  return (await db.getAllFromIndex('characterRecords', 'by-updated-at')).reverse();
}

export async function saveCharacterRecord(
  record: CharacterIdentityRecord,
  reason: CharacterRevisionRecord['reason'] = 'edit',
  changedFields: string[] = [],
): Promise<CharacterIdentityRecord> {
  const db = await openStudioDb();
  const previous = await db.get('characterRecords', record.characterId);
  const now = new Date().toISOString();
  const saved = { ...structuredClone(record), currentRevision: (previous?.currentRevision ?? record.currentRevision - 1) + 1, updatedAt: now };
  const tx = db.transaction(['characterRecords', 'characterRevisions'], 'readwrite');
  await tx.objectStore('characterRecords').put(saved);
  await tx.objectStore('characterRevisions').put({
    id: `${saved.characterId}:r${saved.currentRevision}`, characterId: saved.characterId, revision: saved.currentRevision,
    reason, changedFields, snapshot: structuredClone(saved) as unknown as Record<string, unknown>, createdAt: now,
  });
  await tx.done;
  return saved;
}

export async function addCharacterAssetVersion(input: Omit<CharacterAssetVersionRecord, 'version' | 'status' | 'createdAt'>): Promise<CharacterAssetVersionRecord> {
  const db = await openStudioDb();
  const current = (await listCharacterAssets(input.characterId)).filter((asset) => asset.kind === input.kind);
  const now = new Date().toISOString();
  const saved: CharacterAssetVersionRecord = { ...input, version: (current[0]?.version ?? 0) + 1, status: 'current', createdAt: now };
  const tx = db.transaction('characterAssets', 'readwrite');
  for (const asset of current) await tx.store.put({ ...asset, status: 'superseded' });
  await tx.store.put(saved);
  await tx.done;
  return saved;
}

export async function rollbackCharacterRecord(characterId: string, revision: number): Promise<CharacterIdentityRecord> {
  const target = (await listCharacterRevisions(characterId)).find((item) => item.revision === revision);
  if (!target) throw new Error('指定したキャラクター履歴が見つかりません。');
  return saveCharacterRecord(target.snapshot as unknown as CharacterIdentityRecord, 'rollback', [`revision:${revision}`]);
}

export async function listCharacterRevisions(characterId: string): Promise<CharacterRevisionRecord[]> {
  const db = await openStudioDb();
  return (await db.getAllFromIndex('characterRevisions', 'by-character', characterId)).sort((a, b) => b.revision - a.revision);
}

export async function listCharacterAssets(characterId: string): Promise<CharacterAssetVersionRecord[]> {
  const db = await openStudioDb();
  return (await db.getAllFromIndex('characterAssets', 'by-character', characterId)).sort((a, b) => b.version - a.version);
}

export async function exportCharacterDatabaseJson(): Promise<Blob> {
  const db = await openStudioDb();
  const [characters, assets, revisions] = await Promise.all([
    db.getAll('characterRecords'), db.getAll('characterAssets'), db.getAll('characterRevisions'),
  ]);
  return new Blob([JSON.stringify({ exportSchemaVersion: 1, exportedAt: new Date().toISOString(), characters, assets, revisions }, null, 2)], { type: 'application/json' });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function migrateDraft(raw: unknown): DraftRecord {
  if (!isRecord(raw)) throw new Error('下書きの形式が壊れています。');
  if (raw.schemaVersion === DRAFT_SCHEMA_VERSION) {
    return {
      ...(structuredClone(raw) as unknown as DraftRecord),
      sourceIdentity: isRecord(raw.sourceIdentity)
        && typeof raw.sourceIdentity.id === 'string'
        && typeof raw.sourceIdentity.slug === 'string'
        ? { id: raw.sourceIdentity.id, slug: raw.sourceIdentity.slug }
        : null,
    };
  }

  if (raw.schemaVersion === 1 || raw.schemaVersion === 2 || raw.schemaVersion === 3 || raw.schemaVersion === 4 || raw.schemaVersion === undefined) {
    const fallback = createDraft(typeof raw.id === 'string' ? raw.id : crypto.randomUUID());
    const migrated: DraftRecord = {
      ...fallback,
      ...raw,
      schemaVersion: DRAFT_SCHEMA_VERSION,
      character: isRecord(raw.character) ? { ...fallback.character, ...raw.character } : fallback.character,
      hitImageInfo: isRecord(raw.hitImageInfo) ? raw.hitImageInfo as unknown as DraftRecord['hitImageInfo'] : null,
      editor: isRecord(raw.editor) ? { ...fallback.editor, ...raw.editor } : fallback.editor,
      motion: isRecord(raw.motion) ? { ...fallback.motion, ...raw.motion } : fallback.motion,
      preview: isRecord(raw.preview) ? { ...fallback.preview, ...raw.preview } : fallback.preview,
      landmarks: isRecord(raw.landmarks)
        ? {
            ...fallback.landmarks,
            status: raw.landmarks.status === 'ready' || raw.landmarks.status === 'needs-review' ? raw.landmarks.status : fallback.landmarks.status,
            facing: raw.landmarks.facing === 'left' ? 'left' : 'right',
            ground: isRecord(raw.landmarks.ground) ? raw.landmarks.ground as unknown as DraftRecord['landmarks']['ground'] : fallback.landmarks.ground,
            muzzle: isRecord(raw.landmarks.muzzle) ? raw.landmarks.muzzle as unknown as DraftRecord['landmarks']['muzzle'] : fallback.landmarks.muzzle,
            detectedAt: typeof raw.landmarks.detectedAt === 'string' ? raw.landmarks.detectedAt : null,
          }
        : fallback.landmarks,
      updatedAt: new Date().toISOString(),
      historyStatus: 'dirty',
    } as DraftRecord;
    return migrated;
  }
  throw new Error(`未対応の下書きschemaです: ${String(raw.schemaVersion)}`);
}

export async function saveDraft(record: DraftRecord): Promise<DraftRecord> {
  const db = await openStudioDb();
  const saved: DraftRecord = {
    ...structuredClone(record),
    schemaVersion: DRAFT_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    historyStatus: record.historyStatus === 'corrupt' ? 'corrupt' : 'clean',
  };
  await db.put('drafts', saved);
  return saved;
}

export async function getDraft(id: string): Promise<DraftRecord | null> {
  const db = await openStudioDb();
  const raw = await db.get('drafts', id);
  if (!raw) return null;
  try {
    return migrateDraft(raw);
  } catch {
    const fallback = createDraft(id);
    fallback.title = '壊れた下書き';
    fallback.historyStatus = 'corrupt';
    return fallback;
  }
}

export async function listDrafts(): Promise<DraftRecord[]> {
  const db = await openStudioDb();
  const records = await db.getAllFromIndex('drafts', 'by-updated-at');
  return records.reverse().map((record) => {
    try {
      return migrateDraft(record);
    } catch {
      const fallback = createDraft(record.id);
      fallback.title = '壊れた下書き';
      fallback.historyStatus = 'corrupt';
      return fallback;
    }
  });
}

export async function putDraftBlob(draftId: string, kind: DraftBlobKind, blob: Blob): Promise<StoredBlob> {
  const db = await openStudioDb();
  const stored: StoredBlob = {
    key: `${draftId}:${kind}`,
    draftId,
    kind,
    blob,
    sha256: await digestBlob(blob),
    updatedAt: new Date().toISOString(),
  };
  await db.put('blobs', stored);
  return stored;
}

export async function getDraftBlob(draftId: string, kind: DraftBlobKind): Promise<Blob | null> {
  const db = await openStudioDb();
  return (await db.get('blobs', `${draftId}:${kind}`))?.blob ?? null;
}

export async function deleteDraftBlob(draftId: string, kind: DraftBlobKind): Promise<void> {
  const db = await openStudioDb();
  await db.delete('blobs', `${draftId}:${kind}`);
}

export async function listDraftBlobs(draftId: string): Promise<StoredBlob[]> {
  const db = await openStudioDb();
  return db.getAllFromIndex('blobs', 'by-draft', draftId);
}

export async function duplicateDraft(id: string): Promise<DraftRecord> {
  const source = await getDraft(id);
  if (!source) throw new Error('複製する下書きが見つかりません。');
  const duplicate = structuredClone(source);
  duplicate.id = crypto.randomUUID();
  duplicate.title = `${source.title}（複製）`;
  duplicate.createdAt = new Date().toISOString();
  duplicate.updatedAt = duplicate.createdAt;
  duplicate.historyStatus = 'dirty';
  await saveDraft(duplicate);
  const blobs = await listDraftBlobs(id);
  for (const item of blobs) await putDraftBlob(duplicate.id, item.kind, item.blob);
  return duplicate;
}

export async function deleteDraft(id: string): Promise<void> {
  const db = await openStudioDb();
  const tx = db.transaction(['drafts', 'blobs'], 'readwrite');
  await tx.objectStore('drafts').delete(id);
  const blobKeys = await tx.objectStore('blobs').index('by-draft').getAllKeys(id);
  for (const key of blobKeys) await tx.objectStore('blobs').delete(key);
  await tx.done;
}

export async function putOutbox(record: OutboxRecord): Promise<void> {
  const db = await openStudioDb();
  await db.put('outbox', { ...record, updatedAt: new Date().toISOString() });
}

export async function listOutbox(): Promise<OutboxRecord[]> {
  const db = await openStudioDb();
  return (await db.getAllFromIndex('outbox', 'by-updated-at')).reverse();
}

export async function deleteOutbox(id: string): Promise<void> {
  const db = await openStudioDb();
  await db.delete('outbox', id);
}

export async function addPublishHistory(record: PublishHistoryRecord): Promise<void> {
  const db = await openStudioDb();
  await db.put('history', record);
}

export async function listPublishHistory(): Promise<PublishHistoryRecord[]> {
  const db = await openStudioDb();
  return (await db.getAllFromIndex('history', 'by-completed-at')).reverse();
}

export async function setAppMeta(key: string, value: unknown): Promise<void> {
  const db = await openStudioDb();
  await db.put('appMeta', { key, value });
}

export async function getAppMeta<T>(key: string): Promise<T | null> {
  const db = await openStudioDb();
  return ((await db.get('appMeta', key))?.value as T | undefined) ?? null;
}

interface ExportedBlob {
  kind: DraftBlobKind;
  type: string;
  base64: string;
  sha256: string;
}

interface DraftExportEnvelope {
  exportSchemaVersion: 1;
  exportedAt: string;
  generator: 'Content Studio';
  draft: DraftRecord;
  blobs: ExportedBlob[];
}

export async function exportDraftJson(id: string): Promise<Blob> {
  const draft = await getDraft(id);
  if (!draft) throw new Error('出力する下書きが見つかりません。');
  const storedBlobs = await listDraftBlobs(id);
  const blobs: ExportedBlob[] = [];
  for (const item of storedBlobs) {
    blobs.push({ kind: item.kind, type: item.blob.type, base64: await blobToBase64(item.blob), sha256: item.sha256 });
  }
  const envelope: DraftExportEnvelope = {
    exportSchemaVersion: 1,
    exportedAt: new Date().toISOString(),
    generator: 'Content Studio',
    draft,
    blobs,
  };
  return new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
}

export async function importDraftJson(file: Blob): Promise<DraftRecord> {
  if (file.size > 30 * 1024 * 1024) throw new Error('下書きJSONは30MB以下にしてください。');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('JSONを読み込めませんでした。');
  }
  if (!isRecord(parsed) || parsed.exportSchemaVersion !== 1 || !Array.isArray(parsed.blobs)) throw new Error('Content Studioの下書きJSONではありません。');
  const draft = migrateDraft(parsed.draft);
  draft.id = crypto.randomUUID();
  draft.title = `${draft.title}（読み込み）`;
  draft.createdAt = new Date().toISOString();
  draft.updatedAt = draft.createdAt;
  draft.historyStatus = 'dirty';
  await saveDraft(draft);
  for (const raw of parsed.blobs) {
    if (!isRecord(raw) || typeof raw.kind !== 'string' || typeof raw.type !== 'string' || typeof raw.base64 !== 'string' || typeof raw.sha256 !== 'string') {
      throw new Error('下書き内の画像データが壊れています。');
    }
    if (!isDraftBlobKind(raw.kind)) throw new Error('未対応の画像種類が含まれています。');
    const blob = base64ToBlob(raw.base64, raw.type);
    if (await digestBlob(blob) !== raw.sha256) throw new Error('下書き画像の整合性を確認できません。');
    await putDraftBlob(draft.id, raw.kind, blob);
  }
  return draft;
}

export async function digestBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isDraftBlobKind(value: string): value is DraftBlobKind {
  return [
    'original', 'hit-original', 'working', 'normalized', 'optimized', 'mask', 'sprite',
    'motion-move-forward', 'motion-move-backward', 'motion-fire', 'motion-hit', 'motion-land',
    'icon', 'thumbnail', 'preview',
  ].includes(value);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(bytes.length, index + chunk)));
  }
  return btoa(binary);
}

function base64ToBlob(base64: string, type: string): Blob {
  if (base64.length > 45 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('下書き内の画像データが不正です。');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

export async function resetDatabaseConnectionForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
  }
  dbPromise = null;
}
