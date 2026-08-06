import { createDraft, DEFAULT_CHARACTER, DEFAULT_MOTION } from './defaults';
import { draftRecordSchema } from './schemas';
import { DRAFT_SCHEMA_VERSION, type DraftRecord } from './types';

export class DraftMigrationError extends Error {
  readonly causeDetail: unknown;

  constructor(message: string, causeDetail?: unknown) {
    super(message);
    this.name = 'DraftMigrationError';
    this.causeDetail = causeDetail;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeRecord<T extends object>(defaults: T, value: unknown): T {
  return isRecord(value) ? ({ ...defaults, ...value } as T) : defaults;
}

/**
 * Reads unversioned/v1 drafts and produces the current v2 envelope. Unknown
 * fields are intentionally discarded so stale data cannot cross trust bounds.
 */
export function migrateDraft(input: unknown): DraftRecord {
  if (!isRecord(input)) {
    throw new DraftMigrationError('下書きの形式が正しくありません');
  }

  const version = input.schemaVersion === undefined ? 0 : input.schemaVersion;
  if (version !== 0 && version !== 1 && version !== DRAFT_SCHEMA_VERSION) {
    throw new DraftMigrationError('未対応の下書きバージョンです');
  }

  if (version === DRAFT_SCHEMA_VERSION) {
    const current = draftRecordSchema.safeParse(input);
    if (!current.success) throw new DraftMigrationError('下書きが壊れています', current.error.issues);
    return current.data as DraftRecord;
  }

  const legacyId = typeof input.id === 'string' ? input.id : undefined;
  const base = createDraft(legacyId);
  const legacyCharacter = input.character ?? input.form;
  const legacyStep = input.lastStep ?? input.step;

  const candidate: DraftRecord = {
    ...base,
    id: legacyId ?? base.id,
    title: typeof input.title === 'string' ? input.title : base.title,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : base.createdAt,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : base.updatedAt,
    lastStep: typeof legacyStep === 'string' ? legacyStep as DraftRecord['lastStep'] : base.lastStep,
    character: mergeRecord(DEFAULT_CHARACTER, legacyCharacter),
    imageInfo: isRecord(input.imageInfo) ? input.imageInfo as unknown as DraftRecord['imageInfo'] : null,
    editor: mergeRecord(base.editor, input.editor),
    motionPreset: typeof input.motionPreset === 'string' ? input.motionPreset as DraftRecord['motionPreset'] : base.motionPreset,
    motion: mergeRecord(DEFAULT_MOTION, input.motion),
    preview: mergeRecord(base.preview, input.preview),
    validation: Array.isArray(input.validation) ? input.validation as DraftRecord['validation'] : [],
    processingOperations: Array.isArray(input.processingOperations)
      ? input.processingOperations as DraftRecord['processingOperations']
      : [],
    historyStatus: input.historyStatus === 'dirty' ? 'dirty' : 'clean',
    mockScenario: typeof input.mockScenario === 'string' ? input.mockScenario as DraftRecord['mockScenario'] : 'success',
    sourceIdentity: null,
    schemaVersion: DRAFT_SCHEMA_VERSION,
  };

  const migrated = draftRecordSchema.safeParse(candidate);
  if (!migrated.success) {
    throw new DraftMigrationError('下書きを安全に移行できませんでした', migrated.error.issues);
  }
  return migrated.data as DraftRecord;
}

export function exportDraftJson(draft: DraftRecord): string {
  const valid = draftRecordSchema.parse(draft);
  return `${JSON.stringify(valid, null, 2)}\n`;
}

export function importDraftJson(json: string): DraftRecord {
  if (json.length > 5 * 1024 * 1024) throw new DraftMigrationError('下書きJSONの容量が大きすぎます');
  try {
    return migrateDraft(JSON.parse(json) as unknown);
  } catch (error) {
    if (error instanceof DraftMigrationError) throw error;
    throw new DraftMigrationError('下書きJSONを読み込めませんでした', error);
  }
}
