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
 * Reads legacy drafts and produces the current envelope. Unknown
 * fields are intentionally discarded so stale data cannot cross trust bounds.
 */
export function migrateDraft(input: unknown): DraftRecord {
  if (!isRecord(input)) {
    throw new DraftMigrationError('下書きの形式が正しくありません');
  }

  const version = input.schemaVersion === undefined ? 0 : input.schemaVersion;
  if (version !== 0 && version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== 5 && version !== DRAFT_SCHEMA_VERSION) {
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
  const activeStep = legacyStep === 'image' || legacyStep === 'cutout'
    ? 'image'
    : legacyStep === 'setup' || legacyStep === 'parts'
      ? 'setup'
      : legacyStep === 'motion' || legacyStep === 'preview' || legacyStep === 'export'
        ? 'motion'
        : legacyStep === 'character' || legacyStep === 'details' || legacyStep === 'skills'
          ? 'character'
          : legacyStep === 'validate' || legacyStep === 'publish' || legacyStep === 'complete'
            ? 'publish'
            : base.lastStep;

  const candidate: DraftRecord = {
    ...base,
    id: legacyId ?? base.id,
    title: typeof input.title === 'string' ? input.title : base.title,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : base.createdAt,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : base.updatedAt,
    lastStep: activeStep as DraftRecord['lastStep'],
    character: mergeRecord(DEFAULT_CHARACTER, legacyCharacter),
    imageInfo: isRecord(input.imageInfo) ? input.imageInfo as unknown as DraftRecord['imageInfo'] : null,
    hitImageInfo: isRecord(input.hitImageInfo) ? input.hitImageInfo as unknown as DraftRecord['hitImageInfo'] : null,
    editor: mergeRecord(base.editor, input.editor),
    motionPreset: typeof input.motionPreset === 'string' ? input.motionPreset as DraftRecord['motionPreset'] : base.motionPreset,
    motionAction: typeof input.motionAction === 'string' ? input.motionAction as DraftRecord['motionAction'] : base.motionAction,
    actionPreset: typeof input.actionPreset === 'string' ? input.actionPreset as DraftRecord['actionPreset'] : base.actionPreset,
    motion: mergeRecord(DEFAULT_MOTION, input.motion),
    partDetection: isRecord(input.partDetection)
      ? mergeRecord(base.partDetection, input.partDetection)
      : base.partDetection,
    landmarks: isRecord(input.landmarks)
      ? {
          ...base.landmarks,
          status: input.landmarks.status === 'ready' || input.landmarks.status === 'needs-review' ? input.landmarks.status : base.landmarks.status,
          facing: input.landmarks.facing === 'left' ? 'left' : 'right',
          ground: isRecord(input.landmarks.ground) ? input.landmarks.ground as unknown as DraftRecord['landmarks']['ground'] : base.landmarks.ground,
          muzzle: isRecord(input.landmarks.muzzle) ? input.landmarks.muzzle as unknown as DraftRecord['landmarks']['muzzle'] : base.landmarks.muzzle,
          detectedAt: typeof input.landmarks.detectedAt === 'string' ? input.landmarks.detectedAt : null,
        }
      : base.landmarks,
    motionIntensity: isRecord(input.motionIntensity)
      ? mergeRecord(base.motionIntensity, input.motionIntensity)
      : base.motionIntensity,
    generatedClips: Array.isArray(input.generatedClips)
      ? input.generatedClips as DraftRecord['generatedClips']
      : [],
    publishMode: input.publishMode === 'merge-after-ci' ? 'merge-after-ci' : 'pr-only',
    preview: mergeRecord(base.preview, input.preview),
    validation: Array.isArray(input.validation) ? input.validation as DraftRecord['validation'] : [],
    processingOperations: Array.isArray(input.processingOperations)
      ? input.processingOperations as DraftRecord['processingOperations']
      : [],
    historyStatus: input.historyStatus === 'dirty' ? 'dirty' : 'clean',
    mockScenario: typeof input.mockScenario === 'string' ? input.mockScenario as DraftRecord['mockScenario'] : 'success',
    sourceIdentity: isRecord(input.sourceIdentity)
      && typeof input.sourceIdentity.id === 'string'
      && typeof input.sourceIdentity.slug === 'string'
      ? { id: input.sourceIdentity.id, slug: input.sourceIdentity.slug }
      : null,
    legacyTargetId: typeof input.legacyTargetId === 'string' ? input.legacyTargetId : null,
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
