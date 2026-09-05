import { imageInputKey, hasUnappliedImage, draftClipInputKey, UNAPPLIED_IMAGE_MESSAGE } from '../domain/generation-input';
import { buildInformationBundle, validatePublishedSnapshot, visualEditKey, editingSourceKeys, artifactBlob, type PublishedSnapshot } from '../generation/published-edit';
import { createEditingInput } from '../image/editing-input';
import { saveGeneratedMotions, savePublishedDraft } from '../storage/db';
import { publicationInputKey } from '../domain/publication-input';
import { assertPublishSize } from '../domain/publish-limits';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { createDraft } from '../domain/defaults';
import { getLegacyRepositoryIdentity, LEGACY_CHARACTERS, spriteMetadataSchema, validateCharacter } from '../domain';
import type {
  ArtifactBundle,
  DraftRecord,
  ImageOperation,
  MockScenario,
  MotionClipId,
  MotionIntensityLevel,
  PreparedChange,
  PullRequestResult,
  RepositoryGateway,
  RepositoryStatus,
  SpriteMetadata,
  ValidationIssue,
  WorkflowStep,
} from '../domain/types';
import { GENERATOR_VERSION, WORKFLOW_STEPS } from '../domain/types';
import { buildArtifactBundle, createArtifactZip } from '../generation';
import type { CanonicalCharacterRecord } from '../generation';
import { MockRepositoryGateway } from '../github/mock-gateway';
import { ServerRepositoryGateway } from '../github/server-gateway';
import { ContentImageProcessor, decodeImageBlob, encodePixelBuffer, inspectImageBlob, type ImageProgress, type ProcessedImage } from '../image';
import {
  buildMotionProfileJson,
  buildMotionBatchProfileJson,
  createMotionBatchPackage,
  createMotionPackage,
  detectMotionLandmarks,
  detectMotionParts,
  generateMotionBatch, motionInputKeys,
  generateIdleMotionFromBlob,
  MOTION_CLIP_IDS,
  type EncodedIdleSpriteResult,
  type MotionBatchResult,
  type MotionProgress,
} from '../motion';
import { acquireWakeLock, detectCapabilities, requestPersistentStorage, storageUsage, type Capabilities } from '../pwa/capabilities';
import { consumeSharedImage } from '../pwa/share-target';
import { fetchLegacyImage, readMockPublishedCharacter, loadPublishedContent } from '../game/published-content';
import {
  addPublishHistory,
  deleteDraftBlob,
  deleteDraft,
  duplicateDraft,
  exportDraftJson,
  getAppMeta,
  getDraft,
  getDraftBlob,
  importDraftJson,
  listDrafts,
  listOutbox,
  listPublishHistory,
  putDraftBlob,
  putOutbox,
  saveDraft,
  setAppMeta,
  type DraftBlobKind,
  type OutboxRecord,
  type PublishHistoryRecord,
} from '../storage/db';
import { createAutosaveController } from '../storage/autosave';

export type SaveState = 'idle' | 'pending' | 'saved' | 'error';

export interface StorageSummary {
  usage: number;
  quota: number;
  ratio: number;
  persistent: boolean | null;
}

export interface StudioProgress {
  value: number;
  label: string;
}

export interface StudioController {
  appVersion: string;
  view: 'dashboard' | 'workflow';
  step: WorkflowStep;
  stepIndex: number;
  draft: DraftRecord | null;
  drafts: DraftRecord[];
  publishedCharacters: CanonicalCharacterRecord[];
  publishedWarning: string | null;
  publishedEditingAvailable: boolean;
  history: PublishHistoryRecord[];
  outbox: OutboxRecord[];
  processed: ProcessedImage | null;
  hitProcessed: ProcessedImage | null;
  sprite: EncodedIdleSpriteResult | null;
  motions: Partial<MotionBatchResult>;
  selectedClip: MotionClipId;
  bundle: ArtifactBundle | null;
  prepared: PreparedChange | null;
  pullRequest: PullRequestResult | null;
  repositoryStatus: RepositoryStatus;
  capabilities: Capabilities;
  storage: StorageSummary | null;
  saveState: SaveState;
  savedAt: string | null;
  busy: boolean;
  progress: StudioProgress | null;
  error: string | null;
  notice: string | null;
  redoCount: number;
  installAvailable: boolean;
  installApp(): Promise<void>;
  dismissNotice(): void;
  dismissError(): void;
  createNewDraft(): Promise<void>;
  editLegacyCharacter(id: string): Promise<void>;
  editPublishedCharacter(slug: string): Promise<void>;
  enablePublishedRegeneration(adopt?: boolean): Promise<void>;
  openDraft(id: string): Promise<void>;
  backToDashboard(): Promise<void>;
  duplicateExistingDraft(id: string): Promise<void>;
  deleteExistingDraft(id: string): Promise<void>;
  importDraft(file: Blob): Promise<void>;
  exportDraft(id?: string): Promise<void>;
  updateDraft(updater: (draft: DraftRecord) => DraftRecord): void;
  goToStep(step: WorkflowStep, replace?: boolean): void;
  nextStep(): void;
  previousStep(): void;
  acceptFile(file: File): Promise<void>;
  onFileInput(event: ChangeEvent<HTMLInputElement>): Promise<void>;
  onHitFileInput(event: ChangeEvent<HTMLInputElement>): Promise<void>;
  removeHitImage(): Promise<void>;
  onDrop(event: DragEvent<HTMLElement>): Promise<void>;
  applyImageOperations(operations?: ImageOperation[]): Promise<void>;
  autoRemoveBackground(): Promise<void>;
  autoTrim(): Promise<void>;
  addBrushStroke(operation: Extract<ImageOperation, { type: 'brush' }>): Promise<void>;
  undoImageOperation(): Promise<void>;
  redoImageOperation(): Promise<void>;
  detectParts(): Promise<void>;
  detectLandmarks(): Promise<void>;
  selectMotionClip(clipId: MotionClipId): void;
  setMotionIntensity(clipId: MotionClipId, level: MotionIntensityLevel): Promise<void>;
  generateMotion(): Promise<void>;
  downloadMotionZip(): Promise<void>;
  downloadMotionMetadata(): Promise<void>;
  downloadSpriteSheet(): Promise<void>;
  validateAndBuild(): Promise<ValidationIssue[]>;
  downloadZip(): Promise<void>;
  downloadJson(): Promise<void>;
  prepareChange(): Promise<void>;
  reprepareLatest(): Promise<void>;
  refreshPublishedContent(): Promise<void>;
  createPullRequest(): Promise<void>;
  retryOutbox(id: string): Promise<void>;
  refreshRepositoryStatus(): Promise<void>;
  login(): void;
  logout(): Promise<void>;
  cancelProcessing(): void;
}

const EMPTY_REPOSITORY_STATUS: RepositoryStatus = {
  mode: 'mock',
  connected: true,
  user: '管理者',
  build: 'idle',
  deployment: 'unknown',
  message: 'モックモードを準備しています。',
};

const ALLOWED_FILE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_INPUT_BYTES = 20 * 1024 * 1024;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function humanError(error: unknown, fallback: string): string {
  if (error instanceof DOMException && error.name === 'AbortError') return '処理を中止しました。入力内容は保存されています。';
  return error instanceof Error && error.message ? error.message : fallback;
}

function waitFor(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    const abort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('処理を中止しました。', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function validationExtras(draft: DraftRecord, processed: ProcessedImage | null, motions: Partial<MotionBatchResult>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!draft.imageInfo || !processed) issues.push({ severity: 'error', code: 'image.missing', field: 'image', message: 'キャラクター画像を登録してください。' });
  if (draft.imageInfo && draft.imageInfo.byteLength > MAX_INPUT_BYTES) issues.push({ severity: 'error', code: 'image.too_large', field: 'image', message: '元画像は20MB以下にしてください。' });
  const missingClips = MOTION_CLIP_IDS.filter((clipId) => !motions[clipId] || !draft.generatedClips.includes(clipId));
  if (missingClips.length) issues.push({ severity: 'error', code: 'motion.missing', field: 'motion', message: `5種類のモーションを生成してください（不足: ${missingClips.join(', ')}）` });
  if (processed?.analysis.hasBakedCheckerboard) issues.push({ severity: 'warning', code: 'image.checkerboard', field: 'image', message: '市松模様が焼き付いている可能性があります。透明表示で輪郭を確認してください。' });
  if (processed?.analysis.hasBakedBlackBackground) issues.push({ severity: 'warning', code: 'image.black_background', field: 'image', message: '黒背景が焼き付いている可能性があります。' });
  if (draft.character.specialEnabled && draft.character.specialTemplate === 'custom-required') issues.push({ severity: 'warning', code: 'skill.custom_required', field: 'specialTemplate', message: 'カスタム実装が必要です。自動登録せずPR本文へ仕様メモを出力します。' });
  if (draft.character.specialEnabled && draft.character.specialTemplate === 'custom-required' && !draft.character.customImplementationNote.trim()) issues.push({ severity: 'error', code: 'skill.custom_note_missing', field: 'customImplementationNote', message: 'カスタム実装の仕様メモを入力してください。' });
  if (draft.sourceIdentity && (draft.character.id !== draft.sourceIdentity.id || draft.character.slug !== draft.sourceIdentity.slug)) {
    issues.push({ severity: 'error', code: 'character.identity_locked', field: 'id', message: '更新時は内部IDとslugを変更できません。別キャラクターとして追加してください。' });
  }
  return issues;
}

async function restoreStoredSprite(draftId: string): Promise<EncodedIdleSpriteResult | null> {
  const [blob, storedMetadata] = await Promise.all([
    getDraftBlob(draftId, 'sprite'),
    getAppMeta<unknown>(`${draftId}:sprite-metadata`),
  ]);
  if (!blob || !storedMetadata) return null;
  const parsedMetadata = spriteMetadataSchema.safeParse(storedMetadata);
  if (!parsedMetadata.success) return null;
  const metadata = parsedMetadata.data as SpriteMetadata;

  const dimensions = [metadata.frameWidth, metadata.frameHeight, metadata.frameCount];
  if (!dimensions.every((value) => Number.isSafeInteger(value) && value > 0)) return null;
  const sheetWidth = metadata.frameWidth * metadata.frameCount;
  if (sheetWidth > 8192 || metadata.frameHeight > 8192 || sheetWidth * metadata.frameHeight > 24_000_000) return null;

  try {
    const safety = await inspectImageBlob(blob, 'idle-sprite.png', {
      decodeMaxDimension: Math.max(sheetWidth, metadata.frameHeight),
    });
    const sheet = await decodeImageBlob(blob, safety);
    if (sheet.width !== sheetWidth || sheet.height !== metadata.frameHeight) return null;
    return {
      spriteSheetPng: {
        blob,
        mimeType: 'image/png',
        width: sheet.width,
        height: sheet.height,
        byteLength: blob.size,
      },
      sheet,
      metadata,
      transforms: [],
      frameBounds: Array.from({ length: metadata.frameCount }, () => ({ ...metadata.contentBounds })),
      usedWorker: false,
    };
  } catch {
    return null;
  }
}

const MOTION_BLOB_KIND: Record<MotionClipId, DraftBlobKind> = {
  'move-forward': 'motion-move-forward',
  'move-backward': 'motion-move-backward',
  fire: 'motion-fire',
  hit: 'motion-hit',
  land: 'motion-land',
};

async function restoreStoredMotion(draftId: string, clipId: MotionClipId, lazy = false): Promise<EncodedIdleSpriteResult | null> {
  const [blob, storedMetadata] = await Promise.all([
    getDraftBlob(draftId, MOTION_BLOB_KIND[clipId]),
    getAppMeta<unknown>(`${draftId}:motion:${clipId}:metadata`),
  ]);
  if (!blob || !storedMetadata) return null;
  const parsed = spriteMetadataSchema.safeParse(storedMetadata);
  if (!parsed.success || parsed.data.clipId !== clipId) return null;
  const metadata = parsed.data as SpriteMetadata;
  const sheetWidth = metadata.frameWidth * metadata.frameCount;
  if (sheetWidth > 8192 || metadata.frameHeight > 8192 || sheetWidth * metadata.frameHeight > 24_000_000) return null;
  try {
    const safety = await inspectImageBlob(blob, `${clipId}.png`, { decodeMaxDimension: Math.max(sheetWidth, metadata.frameHeight) });
    const sheet = lazy ? {width:sheetWidth,height:metadata.frameHeight,data:new Uint8ClampedArray(0)} : await decodeImageBlob(blob, safety);
    if (sheet.width !== sheetWidth || sheet.height !== metadata.frameHeight) return null;
    return {
      inputKey: (await getAppMeta<Record<string,string>>(`${draftId}:motion-inputs`))?.[clipId],
      spriteSheetPng: { blob, mimeType: 'image/png', width: sheet.width, height: sheet.height, byteLength: blob.size },
      sheet,
      metadata,
      transforms: [],
      frameBounds: Array.from({ length: metadata.frameCount }, () => ({ ...metadata.contentBounds })),
      usedWorker: false,
    };
  } catch {
    return null;
  }
}

async function restoreMotionBatch(draftId: string, lazy = false): Promise<Partial<MotionBatchResult>> {
  const entries = await Promise.all(MOTION_CLIP_IDS.map(async (clipId) => [clipId, await restoreStoredMotion(draftId, clipId, lazy)] as const));
  return Object.fromEntries(entries.filter((entry): entry is readonly [MotionClipId, EncodedIdleSpriteResult] => entry[1] !== null));
}

async function reusableEditingSources(draft:DraftRecord) {
  const saved=await getAppMeta<{sourceKeys?:ReturnType<typeof editingSourceKeys>;editing?:import('../generation/artifacts').BuildArtifactBundleInput['editing']}>(`${draft.id}:editing-input`);
  const keys=editingSourceKeys(draft),reuse:{source?:Blob;hitSource?:Blob}={};
  if(saved?.sourceKeys?.normal===keys.normal)reuse.source=saved.editing?.source;
  if(saved?.sourceKeys?.hit===keys.hit)reuse.hitSource=saved.editing?.hitSource;
  if(draft.publishedEdit){
    const snapshot=await getAppMeta<PublishedSnapshot>(`${draft.id}:published-snapshot`),recipe=snapshot?.record.editing;
    if(recipe&&snapshot){
      if(!reuse.source&&draft.originalSha256===recipe.source.sha256&&!draft.processingOperations.length)reuse.source=artifactBlob(snapshot.files.find(f=>f.path===snapshot.record.assets.editSourcePng)!);
      if(!reuse.hitSource&&recipe.hitSource&&draft.hitOriginalSha256===recipe.hitSource.sha256)reuse.hitSource=artifactBlob(snapshot.files.find(f=>f.path===snapshot.record.assets.editHitPng)!);
    }
  }
  return reuse;
}

function publicationOutboxId(bundle: ArtifactBundle): string { return 'publish:' + bundle.bundleId + (bundle.revalidation ? ':' + bundle.revalidation.targetBaseSha + ':' + bundle.revalidation.headSha : ''); }

export function useStudioController(): StudioController {
  const appVersion = import.meta.env.VITE_APP_VERSION || '0.6.0';
  const serverMode = import.meta.env.VITE_REPOSITORY_MODE === 'server';
  const gatewayRef = useRef<RepositoryGateway>(
    serverMode
      ? new ServerRepositoryGateway(import.meta.env.VITE_API_BASE_URL || '')
      : new MockRepositoryGateway({ latencyMs: 180 }),
  );
  const [view, setView] = useState<'dashboard' | 'workflow'>('dashboard');
  const [draft, setDraft] = useState<DraftRecord | null>(null);
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [publishedCharacters, setPublishedCharacters] = useState<CanonicalCharacterRecord[]>([]);
  const [publishedWarning, setPublishedWarning] = useState<string | null>('公開一覧を確認中です。');
  const [history, setHistory] = useState<PublishHistoryRecord[]>([]);
  const [outbox, setOutbox] = useState<OutboxRecord[]>([]);
  const [processed, setProcessed] = useState<ProcessedImage | null>(null);
  const [hitProcessed, setHitProcessed] = useState<ProcessedImage | null>(null);
  const [sprite, setSprite] = useState<EncodedIdleSpriteResult | null>(null);
  const [motions, setMotions] = useState<Partial<MotionBatchResult>>({});
  const [selectedClip, setSelectedClip] = useState<MotionClipId>('move-forward');
  const [bundle, setBundleState] = useState<ArtifactBundle | null>(null);
  const [prepared, setPrepared] = useState<PreparedChange | null>(null);
  const [pullRequest, setPullRequest] = useState<PullRequestResult | null>(null);
  const [repositoryStatus, setRepositoryStatus] = useState<RepositoryStatus>(EMPTY_REPOSITORY_STATUS);
  const [capabilities, setCapabilities] = useState<Capabilities>(() => detectCapabilities());
  const [storage, setStorage] = useState<StorageSummary | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<StudioProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [redo, setRedo] = useState<ImageOperation[]>([]);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const originalBlobRef = useRef<Blob | null>(null);
  const hitOriginalBlobRef = useRef<Blob | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hitAbortRef = useRef<AbortController | null>(null);
  const draftRef = useRef<DraftRecord | null>(null);
  const bundleRef = useRef<ArtifactBundle | null>(null);
  const publicationRef = useRef(false);
  const contentEpochRef = useRef(0);
  const publishedSnapshotRef = useRef<PublishedSnapshot | null>(null);
  const publishedLoadingRef = useRef(false);
  const originalWorkRef = useRef<Promise<void> | null>(null);

  const setBundle = useCallback((next: ArtifactBundle | null) => {
    bundleRef.current = next;
    setBundleState(next);
    setPrepared(null);
    setPullRequest(null);
  }, []);

  const refreshLists = useCallback(async () => {
    const [nextDrafts, nextHistory, nextOutbox] = await Promise.all([listDrafts(), listPublishHistory(), listOutbox()]);
    setDrafts(nextDrafts);
    setHistory(nextHistory);
    setOutbox(nextOutbox);
    const estimate = await storageUsage();
    if (estimate) {
      const persistent = await getAppMeta<boolean>('storage-persistent');
      setStorage({ ...estimate, persistent });
    }
  }, []);

  const autosaveRef = useRef(
    createAutosaveController(
      650,
      (saved) => {
        if (draftRef.current?.id === saved.id) {
          setSavedAt(saved.updatedAt);
          setSaveState('saved');
        }
        void refreshLists();
      },
      (cause) => {
        setSaveState('error');
        setError(cause.message);
      },
    ),
  );

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const persistDraftState = useCallback((updater: (current: DraftRecord) => DraftRecord) => {
    const current = draftRef.current;
    if (!current) return;
    const next = updater(structuredClone(current));
    if (publicationInputKey(next) !== publicationInputKey(current)) {
      contentEpochRef.current++;
      setBundle(null);
    }
    next.generatedClips = next.generatedClips.filter(id => draftClipInputKey(current,id) === draftClipInputKey(next,id));
    next.updatedAt = new Date().toISOString();
    draftRef.current = next;
    setDraft(next);
    setSaveState('pending');
    autosaveRef.current.schedule(next);
  }, [setBundle]);

  const refreshRepositoryStatus = useCallback(async () => {
    try {
      setRepositoryStatus(await gatewayRef.current.getStatus());
    } catch (cause) {
      setRepositoryStatus({ ...EMPTY_REPOSITORY_STATUS, connected: false, message: humanError(cause, 'GitHub状態を確認できませんでした。') });
    }
  }, []);

  const refreshPublishedContent = useCallback(async () => {
    setPublishedWarning('公開一覧を確認中です。');
    try {
      if (gatewayRef.current instanceof ServerRepositoryGateway) {
        const {records,warning} = await gatewayRef.current.listPublishedCharacters();
        setPublishedCharacters(records); setPublishedWarning(warning);
      } else {
        const { records, warning } = await loadPublishedContent();
        setPublishedCharacters(records); setPublishedWarning(warning);
      }
    } catch (cause) { setPublishedWarning(humanError(cause,'公開正本の一覧を取得できません。ログイン後に再試行してください。')); }
  }, []);

  useEffect(() => {
    void refreshLists();
    void refreshRepositoryStatus();
    void refreshPublishedContent();
    void requestPersistentStorage().then(async (persistent) => {
      if (persistent !== null) await setAppMeta('storage-persistent', persistent);
      const estimate = await storageUsage();
      if (estimate) setStorage({ ...estimate, persistent });
    });

    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const online = () => {
      setCapabilities(detectCapabilities());
      setNotice('通信が復帰しました。未送信の変更を再送できます。');
      void refreshRepositoryStatus();
    };
    const offline = () => {
      setCapabilities(detectCapabilities());
      setNotice('オフラインです。作業は端末内へ保存されます。');
    };
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [refreshLists, refreshRepositoryStatus, refreshPublishedContent]);

  const updateDraft = useCallback((updater: (current: DraftRecord) => DraftRecord) => {
    persistDraftState(current => ({...updater(current), historyStatus:'dirty'}));
  }, [persistDraftState]);

  const goToStep = useCallback((step: WorkflowStep, replace = false) => {
    persistDraftState((current) => ({ ...current, lastStep: step }));
    const method = replace ? 'replaceState' : 'pushState';
    window.history[method]({ studio: true, step }, '', `#${step}`);
  }, [persistDraftState]);

  const openDraft = useCallback(async (id: string) => {
    const epoch = ++contentEpochRef.current;
    abortRef.current?.abort(); hitAbortRef.current?.abort();
    await autosaveRef.current.flush();
    const stored = await getDraft(id);
    if (!stored) {
      setError('下書きが見つかりませんでした。');
      return;
    }
    const published = stored.publishedEdit ? await getAppMeta<PublishedSnapshot>(`${id}:published-snapshot`) : null;
    if (stored.publishedEdit && !published) throw new Error('公開元生成物が不足しています。下書きを保持して停止しました。');
    if (published) await validatePublishedSnapshot(published, false);
    const [original, hitOriginal, restoredSprite, restoredMotions] = await Promise.all([
      getDraftBlob(id, 'original'),
      getDraftBlob(id, 'hit-original'),
      stored.publishedEdit ? Promise.resolve(null) : restoreStoredSprite(id),
      restoreMotionBatch(id, Boolean(stored.publishedEdit)),
    ]);
    if (epoch !== contentEpochRef.current) return;
    publishedSnapshotRef.current = published;
    originalBlobRef.current = original;
    hitOriginalBlobRef.current = hitOriginal;
    setDraft(stored);
    draftRef.current = stored;
    setProcessed(null);
    setHitProcessed(null);
    setMotions(restoredMotions);
    const firstRestored = MOTION_CLIP_IDS.find((clipId) => restoredMotions[clipId]);
    setSelectedClip(firstRestored ?? 'move-forward');
    setSprite(firstRestored ? restoredMotions[firstRestored]! : restoredSprite);
    setBundle(null);
    setPrepared(null);
    setPullRequest(null);
    setRedo([]);
    setView('workflow');
    setSavedAt(stored.updatedAt);
    setSaveState('saved');
    window.history.pushState({ studio: true, step: stored.lastStep }, '', `#${stored.lastStep}`);
    if ((original || hitOriginal) && stored.publishedEdit?.mode !== 'information') {
      setNotice('下書きを復旧しました。画像プレビューを再構築しています。');
      setTimeout(() => void (async () => {
        if (epoch !== contentEpochRef.current || draftRef.current?.id !== id) return;
        if (original) await rebuildImage(stored, original, false, stored.processingOperations, true).catch(() => undefined);
        if (epoch !== contentEpochRef.current || draftRef.current?.id !== id) return;
        if (hitOriginal) await rebuildHitImage(stored, hitOriginal, false, true).catch(() => undefined);
        if (epoch === contentEpochRef.current && draftRef.current?.id === id) setNotice('画像プレビューの復元処理が完了しました。保存した公開操作は保持しています。');
      })().catch(() => undefined), 0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createNewDraft = useCallback(async () => {
    contentEpochRef.current++; abortRef.current?.abort(); hitAbortRef.current?.abort();
    await autosaveRef.current.flush();
    const next = createDraft();
    const saved = await saveDraft(next);
    originalBlobRef.current = null;
    hitOriginalBlobRef.current = null;
    setDraft(saved);
    draftRef.current = saved;
    setProcessed(null);
    setHitProcessed(null);
    setSprite(null);
    setMotions({});
    setSelectedClip('move-forward');
    setBundle(null);
    setPrepared(null);
    setPullRequest(null);
    setRedo([]);
    setView('workflow');
    setSavedAt(saved.updatedAt);
    setSaveState('saved');
    window.history.pushState({ studio: true, step: 'image' }, '', '#image');
    await refreshLists();
  }, [refreshLists]);

  const backToDashboard = useCallback(async () => {
    contentEpochRef.current++; abortRef.current?.abort(); hitAbortRef.current?.abort();
    await autosaveRef.current.flush();
    setView('dashboard');
    window.history.pushState({ studio: false }, '', window.location.pathname);
    await refreshLists();
  }, [refreshLists]);

  useEffect(() => {
    const onPopState = () => {
      const current = draftRef.current;
      if (!current || view !== 'workflow') return;
      const index = WORKFLOW_STEPS.findIndex(({ id }) => id === current.lastStep);
      if (index > 0) {
        persistDraftState((item) => ({ ...item, lastStep: WORKFLOW_STEPS[index - 1].id }));
      } else {
        setView('dashboard');
      }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (saveState !== 'pending' && !busy) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [busy, saveState, updateDraft, view]);

  useEffect(() => {
    const saveWhenHidden = () => {
      if (document.visibilityState === 'hidden') {
        void autosaveRef.current.flush();
      }
    };
    document.addEventListener('visibilitychange', saveWhenHidden);
    return () => document.removeEventListener('visibilitychange', saveWhenHidden);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const shared = params.get('shared');
    if (shared) {
      void consumeSharedImage(shared).then(async (file) => {
        window.history.replaceState({}, '', location.pathname);
        if (!file) {
          setError('共有画像を受け取れませんでした。通常のファイル選択を利用してください。');
          return;
        }
        if (!draftRef.current) await createNewDraft();
        await acceptFile(file);
      });
    } else if (params.has('new')) {
      window.history.replaceState({}, '', location.pathname);
      void createNewDraft();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setBusyProgress = useCallback((value: number, label: string) => {
    setProgress({ value: Math.max(0, Math.min(1, value)), label });
  }, []);

  const rebuildImage = useCallback(async (snapshot: DraftRecord, source: Blob, generateVariants: boolean, operations = snapshot.processingOperations, restoring = false) => {
    if (draftRef.current?.id !== snapshot.id) return;
    if (!restoring) { contentEpochRef.current++; setBundle(null); updateDraft(d=>({...d,appliedImageInputKey:undefined})); }
    const epoch = contentEpochRef.current;
    let finishOriginal!: () => void;
    const originalWork = new Promise<void>(resolve => { finishOriginal = resolve; });
    originalWorkRef.current = originalWork;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const isCurrent = () => epoch === contentEpochRef.current && draftRef.current?.id === snapshot.id && !controller.signal.aborted;
    setBusy(true);
    if (!restoring) setError(null);
    const wakeLock = await acquireWakeLock();
    try {
      const result = await new ContentImageProcessor().process(
        {
          fileName: snapshot.imageInfo?.fileName || 'character-image.png',
          blob: source,
          removeBackground: false,
          background: { tolerance: snapshot.editor.tolerance, feather: snapshot.editor.edgeFeather },
          operations,
          normalize: {
            outputSize: snapshot.editor.outputSize,
            padding: snapshot.editor.padding,
            offsetX: snapshot.editor.offsetX,
            offsetY: snapshot.editor.offsetY,
            scale: snapshot.editor.scale,
            flipHorizontal: snapshot.editor.flipHorizontal,
          },
          generateVariants,
        },
        {
          signal: controller.signal,
          onProgress: (item: ImageProgress) => { if (isCurrent()) setBusyProgress(item.progress, item.message); },
        },
      );
      const working = result.variants ? await encodePixelBuffer(result.edited, 'image/png').then(({blob}) => blob) : null;
      if (!isCurrent()) return;
      setProcessed(result);
      if (generateVariants) {
        setSprite(null);
        setMotions({});
      }
      const imageInfo = { ...result.info, fileName: snapshot.imageInfo?.fileName || result.info.fileName, status: 'ready' as const };
      const landmarks = snapshot.landmarks.status === 'idle'
        ? detectMotionLandmarks(result.normalized.pixels, snapshot.landmarks.facing)
        : snapshot.landmarks;

      if (result.variants) {
        await Promise.all([
          putDraftBlob(snapshot.id, 'working', working!),
          putDraftBlob(snapshot.id, 'normalized', result.variants.normalizedPng.blob),
          putDraftBlob(snapshot.id, 'optimized', result.variants.lightweightWebp.blob),
          putDraftBlob(snapshot.id, 'icon', result.variants.iconPng.blob),
          putDraftBlob(snapshot.id, 'thumbnail', result.variants.thumbnail.blob),
          setAppMeta(`${snapshot.id}:sprite-metadata`, null),
          ...MOTION_CLIP_IDS.map((clipId) => setAppMeta(`${snapshot.id}:motion:${clipId}:metadata`, null)),
        ]);
      }
      if (!restoring && isCurrent()) updateDraft((current) => ({ ...current, imageInfo, processingOperations: operations, landmarks, appliedImageInputKey: imageInputKey(snapshot), generatedClips: generateVariants ? [] : current.generatedClips }));
      return result;
    } catch (cause) {
      if (isCurrent()) setError(humanError(cause, restoring ? '元画像プレビューを復元できませんでした。保存済み生成物と既存PRは保持しています。' : '画像処理に失敗しました。再試行してください。'));
      throw cause;
    } finally {
      await wakeLock?.release().catch(() => undefined);
      if (abortRef.current === controller) { abortRef.current = null; setBusy(false); setProgress(null); }
      if (originalWorkRef.current === originalWork) originalWorkRef.current = null;
      finishOriginal();
    }
  }, [setBusyProgress, updateDraft]);

  const rebuildHitImage = useCallback(async (snapshot: DraftRecord, source: Blob, invalidateMotion: boolean, restoring = false) => {
    if (draftRef.current?.id !== snapshot.id) return;
    if (!restoring) { contentEpochRef.current++; setBundle(null); }
    const epoch = contentEpochRef.current;
    hitAbortRef.current?.abort();
    const controller = new AbortController();
    hitAbortRef.current = controller;
    const isCurrent = () => epoch === contentEpochRef.current && draftRef.current?.id === snapshot.id && !controller.signal.aborted;
    setBusy(true);
    if (!restoring) setError(null);
    const wakeLock = await acquireWakeLock();
    const process = (removeBackground: boolean) => new ContentImageProcessor().process(
      {
        fileName: snapshot.hitImageInfo?.fileName || 'hit-image.png',
        blob: source,
        removeBackground,
        background: { tolerance: snapshot.editor.tolerance, feather: snapshot.editor.edgeFeather },
        normalize: {
          outputSize: snapshot.editor.outputSize,
          padding: snapshot.editor.padding,
          offsetX: snapshot.editor.offsetX,
          offsetY: snapshot.editor.offsetY,
          scale: snapshot.editor.scale,
          flipHorizontal: snapshot.editor.flipHorizontal,
        },
        generateVariants: false,
      },
      {
        signal: controller.signal,
        onProgress: (item: ImageProgress) => { if (isCurrent()) setBusyProgress(item.progress, `被弾用: ${item.message}`); },
      },
    );
    try {
      let result = await process(false);
      if (!isCurrent()) return;
      if (!snapshot.publishedEdit && !result.analysis.hasAlpha && result.analysis.isLikelySolidBackground) {
        setBusyProgress(0.36, '被弾用画像の単色背景を除去しています');
        result = await process(true);
      }
      if (!isCurrent()) return;
      setHitProcessed(result);
      const hitImageInfo = {
        ...result.info,
        fileName: snapshot.hitImageInfo?.fileName || result.info.fileName,
        status: 'ready' as const,
      };
      if (!restoring) persistDraftState((current) => current.id === snapshot.id
        ? { ...current, hitImageInfo, generatedClips: invalidateMotion ? current.generatedClips.filter(id=>id!=='hit') : current.generatedClips }
        : current);
      if (invalidateMotion) {
        setMotions(previous=>{const next={...previous};delete next.hit;return next;});
        if(selectedClip==='hit')setSprite(null);
        await setAppMeta(`${snapshot.id}:motion:hit:metadata`,null);
      }
      return result;
    } catch (cause) {
      if (isCurrent()) setError(humanError(cause, restoring ? '被弾画像プレビューを復元できませんでした。保存済み生成物と既存PRは保持しています。' : '被弾用画像を処理できませんでした。再試行してください。'));
      throw cause;
    } finally {
      await wakeLock?.release().catch(() => undefined);
      if (hitAbortRef.current === controller) { hitAbortRef.current = null; setBusy(false); setProgress(null); }
    }
  }, [persistDraftState, selectedClip, setBusyProgress]);

  const acceptFile = useCallback(async (file: File) => {
    const current = draftRef.current;
    if (!current) return;
    if (!ALLOWED_FILE_TYPES.has(file.type)) {
      setError('PNG、JPEG、WebPのいずれかを選んでください。');
      return;
    }
    if (file.size <= 0 || file.size > MAX_INPUT_BYTES) {
      setError('画像は20MB以下にしてください。大きい画像は端末側で縮小してから再試行できます。');
      return;
    }
    contentEpochRef.current++; setBundle(null);
    const epoch=contentEpochRef.current;
    originalBlobRef.current = file;
    const storedSource = await putDraftBlob(current.id, 'original', file);
    if(epoch!==contentEpochRef.current || draftRef.current?.id!==current.id)return;
    const next: DraftRecord = {
      ...current,
      originalSha256: storedSource.sha256,
      imageInfo: {
        fileName: file.name,
        mimeType: file.type as 'image/png' | 'image/jpeg' | 'image/webp',
        byteLength: file.size,
        width: 0,
        height: 0,
        hasAlpha: false,
        colorMode: 'unknown',
        estimatedOutputBytes: 0,
        status: 'reading',
        warnings: [],
      },
      processingOperations: [],
      landmarks: { ...current.landmarks, status: 'idle', detectedAt: null },
      generatedClips: [],
      updatedAt: new Date().toISOString(),
      historyStatus: 'dirty',
    };
    setDraft(next);
    draftRef.current = next;
    setRedo([]);
    await rebuildImage(next, file, true, []);
  }, [rebuildImage]);

  const onFileInput = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await acceptFile(file);
  }, [acceptFile]);

  const acceptHitFile = useCallback(async (file: File) => {
    const requestedDraftId = draftRef.current?.id;
    // A rapid second file selection must not invalidate the normal image still being imported.
    setBundle(null);
    await originalWorkRef.current;
    const current = draftRef.current;
    if (current?.id !== requestedDraftId) return;
    if (!current) return;
    if (!ALLOWED_FILE_TYPES.has(file.type)) {
      setError('被弾用画像はPNG、JPEG、WebPのいずれかを選んでください。');
      return;
    }
    if (file.size <= 0 || file.size > MAX_INPUT_BYTES) {
      setError('被弾用画像は20MB以下にしてください。');
      return;
    }
    contentEpochRef.current++; setBundle(null);
    const epoch=contentEpochRef.current;
    hitOriginalBlobRef.current = file;
    const storedSource = await putDraftBlob(current.id, 'hit-original', file);
    if(epoch!==contentEpochRef.current || draftRef.current?.id!==current.id)return;
    const next: DraftRecord = {
      ...current,
      hitOriginalSha256: storedSource.sha256,
      hitImageInfo: {
        fileName: file.name,
        mimeType: file.type as 'image/png' | 'image/jpeg' | 'image/webp',
        byteLength: file.size,
        width: 0,
        height: 0,
        hasAlpha: false,
        colorMode: 'unknown',
        estimatedOutputBytes: 0,
        status: 'reading',
        warnings: [],
      },
      generatedClips: current.generatedClips.filter(id=>id!=='hit'),
      updatedAt: new Date().toISOString(),
      historyStatus: 'dirty',
    };
    setDraft(next);
    draftRef.current = next;
    await rebuildHitImage(next, file, true);
    setNotice('被弾用画像を保存しました。被弾モーションだけに使います。');
  }, [rebuildHitImage]);

  const onHitFileInput = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await acceptHitFile(file);
  }, [acceptHitFile]);

  const removeHitImage = useCallback(async () => {
    const current = draftRef.current;
    if (!current) return;
    hitAbortRef.current?.abort();
    hitOriginalBlobRef.current = null;
    setHitProcessed(null);
    await Promise.all([
      deleteDraftBlob(current.id, 'hit-original'),
      setAppMeta(`${current.id}:motion:hit:metadata`,null),
    ]);
    setMotions(previous=>{const next={...previous};delete next.hit;return next;});
    if(selectedClip==='hit')setSprite(null);
    persistDraftState((active) => active.id === current.id
      ? { ...active, hitImageInfo: null, hitOriginalSha256: undefined, generatedClips: active.generatedClips.filter(id=>id!=='hit') }
      : active);
    setNotice('被弾用画像を外しました。次回生成は通常画像を使います。');
  }, [persistDraftState, selectedClip]);

  const onDrop = useCallback(async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) await acceptFile(file);
  }, [acceptFile]);

  const editPublishedCharacter = useCallback(async (slug: string) => {
    if (publishedLoadingRef.current) return;
    const record = publishedCharacters.find(item => item.character.slug === slug);
    if (!record) { setError('公開済みキャラが見つかりません。'); return; }
    publishedLoadingRef.current = true;
    const epoch = ++contentEpochRef.current;
    let opening=false;
    abortRef.current?.abort(); hitAbortRef.current?.abort();
    setBusy(true); setError(null);
    try {
      await autosaveRef.current.flush();
      const snapshot = gatewayRef.current instanceof ServerRepositoryGateway
        ? await gatewayRef.current.readPublishedCharacter(slug) : await readMockPublishedCharacter(record);
      if (epoch !== contentEpochRef.current) return;
      const next = createDraft(), source = snapshot.record, recipe = source.editing;
      next.title = `${source.character.displayName}を更新`;
      next.character = structuredClone(source.character);
      next.sourceIdentity = {id:source.character.id,slug:source.character.slug};
      next.legacyTargetId = source.legacyTargetId ?? null;
      next.lastStep = 'character'; next.generatedClips = source.motionMetadata ? [...MOTION_CLIP_IDS] : [];
      if (recipe) {
        next.editor = {...next.editor,...recipe.placement,outputSize:recipe.placement.referenceSize};
        delete (next.editor as unknown as Record<string,unknown>).referenceSize;
        next.landmarks = {...next.landmarks,...recipe.landmarks,ground:{...next.landmarks.ground,...recipe.landmarks.ground},muzzle:{...next.landmarks.muzzle,...recipe.landmarks.muzzle},status:'ready'};
        next.motionIntensity = {...recipe.intensity}; next.motion.outputSize = recipe.outputSize;
        next.originalSha256 = recipe.source.sha256; next.hitOriginalSha256 = recipe.hitSource?.sha256;
      }
      const info = (path:string, width:number,height:number): NonNullable<DraftRecord['imageInfo']> => ({fileName:'published-edit.png',mimeType:'image/png',byteLength:snapshot.files.find(f=>f.path===path)!.byteLength,width,height,hasAlpha:true,colorMode:'sRGB',estimatedOutputBytes:0,status:'ready',warnings:[]});
      next.imageInfo = info(source.assets.editSourcePng ?? source.assets.normalizedPng,recipe?.source.width ?? source.spriteMetadata.frameWidth,recipe?.source.height ?? source.spriteMetadata.frameHeight);
      next.hitImageInfo = recipe?.hitSource && source.assets.editHitPng ? info(source.assets.editHitPng,recipe.hitSource.width,recipe.hitSource.height) : null;
      if (recipe) next.appliedImageInputKey = imageInputKey(next);
      next.publishedEdit = {revision:snapshot.revision,mode:'information',visualKey:visualEditKey(next)};
      const saved = await savePublishedDraft(next,snapshot);
      if (epoch !== contentEpochRef.current) return;
      opening=true;await openDraft(saved.id); await refreshLists();
      setNotice(recipe ? '公開元の画像・5動作・編集入力を読み込みました。未変更の生成物はそのまま保持します。' : '公開生成物を保持しました。旧形式のため元の編集条件は未復元です。情報編集は可能です。');
    } catch(cause) { if(epoch===contentEpochRef.current)setError(humanError(cause,'公開データを読み込めません。現在の下書きは保持しています。')); }
    finally {publishedLoadingRef.current=false;if(contentEpochRef.current===epoch+(opening?1:0))setBusy(false);}
  }, [openDraft,publishedCharacters,refreshLists]);

  const enablePublishedRegeneration = useCallback(async (adopt = false) => {
    const current=draftRef.current,snapshot=publishedSnapshotRef.current;
    if(!current?.publishedEdit||!snapshot)return;
    if((!snapshot.record.editing || snapshot.record.editing.generatorVersion!==GENERATOR_VERSION)&&!adopt){setError('元の編集条件は未復元です。公開画像を新しい編集元にするか、画像を選び直してください。');return;}
    const epoch=++contentEpochRef.current;
    try{
      if(adopt&&(!snapshot.record.editing || snapshot.record.editing.generatorVersion!==GENERATOR_VERSION)){
        const blob=await getDraftBlob(current.id,'normalized');if(!blob)throw new Error('公開画像がありません。');
        if(epoch!==contentEpochRef.current)return;
        updateDraft(d=>({...d,publishedEdit:{...d.publishedEdit!,mode:'regenerate'},processingOperations:[],editor:createDraft().editor,landmarks:{...createDraft().landmarks,facing:d.character.sourceFacesLeft?'left':'right'}}));
        await acceptFile(new File([blob],'published-baseline.png',{type:'image/png'}));
      }else{
        const original=await getDraftBlob(current.id,'original'),hit=await getDraftBlob(current.id,'hit-original');
        if(!original)throw new Error('検証済み編集入力がありません。');
        await rebuildImage(current,original,false,[],true);
        if(epoch!==contentEpochRef.current||draftRef.current?.id!==current.id)return;
        if(hit)await rebuildHitImage(current,hit,false,true);
        if(epoch!==contentEpochRef.current||draftRef.current?.id!==current.id)return;
        persistDraftState(d=>({...d,publishedEdit:{...d.publishedEdit!,mode:'regenerate'}}));
      }
      goToStep('setup');setNotice('加工済み画像を編集開始地点として復元しました。変更した生成物だけを作り直します。');
    }catch(cause){setError(humanError(cause,'編集入力を復元できません。公開生成物は保持しています。'));}
  },[acceptFile,goToStep,persistDraftState,rebuildHitImage,rebuildImage,updateDraft]);

  const editLegacyCharacter = useCallback(async (id: string) => {
    const record = LEGACY_CHARACTERS.find((item) => item.id === id);
    if (!record) {
      setError('既存キャラクターが見つかりませんでした。');
      return;
    }
    const epoch = ++contentEpochRef.current;
    abortRef.current?.abort(); hitAbortRef.current?.abort();
    try {
      await autosaveRef.current.flush();
      const next = createDraft();
      const repositoryId = getLegacyRepositoryIdentity(record.id).id;
      next.title = `${record.displayName}へモーションを追加`;
      next.character = {
        ...next.character,
        id: repositoryId,
        slug: record.slug,
        displayName: record.displayName,
        sourceFacesLeft: record.facesLeft,
        specialEnabled: false,
        specialName: '既存設定を保持',
      };
      next.sourceIdentity = { id: repositoryId, slug: record.slug };
      next.legacyTargetId = record.id;
      next.landmarks = { ...next.landmarks, facing: record.facesLeft ? 'left' : 'right' };
      next.lastStep = 'image';
      const saved = await saveDraft(next);
      if(epoch!==contentEpochRef.current)return;
      originalBlobRef.current = null;
      hitOriginalBlobRef.current = null;
      setDraft(saved);
      draftRef.current = saved;
      setProcessed(null);
      setHitProcessed(null);
      setSprite(null);
      setMotions({});
      setSelectedClip('move-forward');
      setBundle(null);
      setPrepared(null);
      setPullRequest(null);
      setRedo([]);
      setView('workflow');
      setSavedAt(saved.updatedAt);
      setSaveState('saved');
      window.history.pushState({ studio: true, step: 'image' }, '', '#image');
      const file=await fetchLegacyImage(record);
      if(epoch!==contentEpochRef.current || draftRef.current?.id!==saved.id)return;
      await acceptFile(file);
      setNotice('既存の能力・技・静止画像は変更せず、5モーションだけを追加する下書きを作りました。');
      await refreshLists();
    } catch (cause) {
      setError(humanError(cause, '既存キャラクターを読み込めませんでした。'));
    }
  }, [acceptFile, refreshLists, setBundle]);

  const applyImageOperations = useCallback(async (operations?: ImageOperation[]) => {
    const current = draftRef.current;
    const source = originalBlobRef.current;
    if (!current || !source) {
      setError('先に画像を登録してください。');
      return;
    }
    await rebuildImage(current, source, true, operations ?? current.processingOperations);
  }, [rebuildImage]);

  const autoRemoveBackground = useCallback(async () => {
    const current = draftRef.current;
    if (!current) return;
    const operations: ImageOperation[] = current.processingOperations.filter((operation) => operation.type !== 'remove-background');
    operations.unshift({ type: 'remove-background', tolerance: current.editor.tolerance, feather: current.editor.edgeFeather });
    setRedo([]);
    await applyImageOperations(operations);
  }, [applyImageOperations]);

  const autoTrim = useCallback(async () => {
    const current = draftRef.current;
    if (!current) return;
    const operations = [...current.processingOperations, { type: 'trim' } as const];
    setRedo([]);
    await applyImageOperations(operations);
  }, [applyImageOperations]);

  const addBrushStroke = useCallback(async (operation: Extract<ImageOperation, { type: 'brush' }>) => {
    const current = draftRef.current;
    if (!current) return;
    setRedo([]);
    await applyImageOperations([...current.processingOperations, operation]);
  }, [applyImageOperations]);

  const undoImageOperation = useCallback(async () => {
    const current = draftRef.current;
    if (!current || current.processingOperations.length === 0) return;
    const operations = [...current.processingOperations];
    const removed = operations.pop();
    if (removed) setRedo((items) => [removed, ...items].slice(0, 20));
    await applyImageOperations(operations);
  }, [applyImageOperations]);

  const redoImageOperation = useCallback(async () => {
    const current = draftRef.current;
    const operation = redo[0];
    if (!current || !operation) return;
    setRedo((items) => items.slice(1));
    await applyImageOperations([...current.processingOperations, operation]);
  }, [applyImageOperations, redo]);

  const detectParts = useCallback(async () => {
    const current = draftRef.current;
    const source = processed?.normalized.pixels;
    if (!current || !source) {
      setError('先に画像を切り抜いてください。画像の復旧中は少し待ってから再試行できます。');
      return;
    }
    try {
      const detection = detectMotionParts(source);
      persistDraftState((active) => active.id === current.id
        ? { ...active, partDetection: detection }
        : active);
      setNotice(detection.parts.length >= 3
        ? `${detection.parts.length}個の部位候補を端末内で検出しました。必要なら役割を選び直せます。`
        : '部位候補が少ないため確認が必要です。切り抜きを調整して再検出できます。');
    } catch (cause) {
      setError(humanError(cause, '部位候補を検出できませんでした。'));
    }
  }, [persistDraftState, processed]);

  const detectLandmarks = useCallback(async () => {
    const current = draftRef.current;
    const source = processed?.normalized.pixels;
    if (!current || !source) {
      setError('先に画像を登録して切り抜きを確認してください。');
      return;
    }
    try {
      const landmarks = detectMotionLandmarks(source, current.landmarks.facing);
      const partDetection = detectMotionParts(source);
      persistDraftState((active) => active.id === current.id
        ? {
          ...active,
          landmarks,
          partDetection,
          character: { ...active.character, sourceFacesLeft: landmarks.facing === 'left' },
          generatedClips: [],
        }
        : active);
      setMotions({});
      setSprite(null);
      setNotice('接地点と砲口を端末内で推測しました。ズレていれば画像をタップして直せます。');
    } catch (cause) {
      setError(humanError(cause, '位置を推測できませんでした。手動で指定できます。'));
    }
  }, [persistDraftState, processed]);

  const selectMotionClip = useCallback((clipId: MotionClipId) => {
    setSelectedClip(clipId);
    setSprite(motions[clipId] ?? null);
  }, [motions]);

  const setMotionIntensity = useCallback(async (clipId: MotionClipId, level: MotionIntensityLevel) => {
    const current = draftRef.current;
    if (!current || current.motionIntensity[clipId] === level) return;
    setMotions(previous=>{const next={...previous};delete next[clipId];return next;});
    if (selectedClip===clipId) setSprite(null);
    persistDraftState(active=>active.id===current.id?{...active,motionIntensity:{...active.motionIntensity,[clipId]:level},generatedClips:active.generatedClips.filter(id=>id!==clipId)}:active);
    await setAppMeta(`${current.id}:motion:${clipId}:metadata`,null);
    if(clipId==='move-forward')await setAppMeta(`${current.id}:sprite-metadata`,null);
    setNotice('変更した動作だけ再生成します。未変更のPNGは保持します。');
  }, [persistDraftState,selectedClip]);

  const generateMotion = useCallback(async () => {
    const current = draftRef.current;
    const source = processed?.edited;
    if (!current || !source) {
      setError('先に画像を切り抜いて正規化してください。');
      return;
    }
    if (hasUnappliedImage(current)) { setError(UNAPPLIED_IMAGE_MESSAGE); return; }
    if (current.hitImageInfo && !hitProcessed) {
      setError('被弾用画像を復旧できていません。画像ステップで選び直すか、被弾用画像を外してください。');
      return;
    }
    contentEpochRef.current++;setBundle(null);
    const epoch=contentEpochRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    const wakeLock = await acquireWakeLock();
    try {
      const landmarks = current.landmarks.status === 'idle'
        ? detectMotionLandmarks(processed.normalized.pixels, current.landmarks.facing)
        : current.landmarks;
      const request = {
        reuse: Object.fromEntries(current.generatedClips.filter(id=>motions[id]).map(id=>[id,motions[id]])),
        source,
        hitSource: hitProcessed?.edited,
        sourceImage: 'normalized.png',
        landmarks,
        outputSize: current.motion.outputSize,
        intensity: current.motionIntensity,
        sourcePlacement: {
          padding: current.editor.padding,
          offsetX: current.editor.offsetX,
          offsetY: current.editor.offsetY,
          scale: current.editor.scale,
          flipHorizontal: current.editor.flipHorizontal,
          referenceSize: current.editor.outputSize,
        },
      };
      // Verified published checkpoints can establish local keys without encoding PNGs.
      const recipe=publishedSnapshotRef.current?.record.editing;
      if(recipe?.generatorVersion===GENERATOR_VERSION && current.originalSha256===recipe.source.sha256 && current.hitOriginalSha256===recipe.hitSource?.sha256 && current.processingOperations.length===0) {
        const baselineKeys=await motionInputKeys({...request,sourcePlacement:recipe.placement,landmarks:{...landmarks,...recipe.landmarks},outputSize:recipe.outputSize,intensity:recipe.intensity});
        for(const id of MOTION_CLIP_IDS) if(request.reuse[id] && !request.reuse[id].inputKey) request.reuse[id]={...request.reuse[id],inputKey:baselineKeys[id]};
      }
      const result = await generateMotionBatch(request, {
        signal: controller.signal,
        onProgress: (item) => { if(epoch===contentEpochRef.current && !controller.signal.aborted)setBusyProgress(item.progress, item.message); },
      });
      if(epoch!==contentEpochRef.current || draftRef.current?.id!==current.id || controller.signal.aborted)return;
      const active = result['move-forward'];
      const generatedDraft={...current,landmarks};
      const editing=await createEditingInput(generatedDraft,source,hitProcessed?.edited,result,await reusableEditingSources(generatedDraft));
      await saveGeneratedMotions(generatedDraft,result,editing,visualEditKey(generatedDraft),()=>epoch===contentEpochRef.current&&draftRef.current?.id===current.id&&!controller.signal.aborted);
      if(epoch!==contentEpochRef.current || draftRef.current?.id!==current.id || controller.signal.aborted)return;
      setMotions(result); setSelectedClip('move-forward'); setSprite(active);
      persistDraftState((draftItem) => draftItem.id === current.id
        ? {
          ...draftItem,
          landmarks,
          generatedClips: [...MOTION_CLIP_IDS],
          preview: { ...draftItem.preview, playing: true },
        }
        : draftItem);
      // Preserve every generated blob before reporting publication limits.
      assertPublishSize(MOTION_CLIP_IDS.map(clipId => ({ path: clipId, byteLength: result[clipId].spriteSheetPng.blob.size })), repositoryStatus.publishLimits);
      const usedWorker = MOTION_CLIP_IDS.every((clipId) => result[clipId].usedWorker);
      setNotice(usedWorker
        ? '前進・後退・単発砲撃・被弾・着地の5種類を高画質で生成しました。'
        : 'Worker未対応のため、端末を固めない軽量画質で5種類を生成しました。');
    } catch (cause) {
      if(epoch===contentEpochRef.current && !controller.signal.aborted)setError(humanError(cause, '5種類のモーションを生成できませんでした。'));
    } finally {
      await wakeLock?.release().catch(() => undefined);
      if (abortRef.current === controller) { abortRef.current = null; setBusy(false); setProgress(null); }
    }
  }, [hitProcessed, motions, persistDraftState, processed, repositoryStatus.publishLimits, setBusyProgress]);

  const downloadMotionZip = useCallback(async () => {
    const current = draftRef.current;
    if (current && hasUnappliedImage(current) && current.publishedEdit?.mode!=='information') { setError(UNAPPLIED_IMAGE_MESSAGE); return; }
    const complete = MOTION_CLIP_IDS.every((clipId) => motions[clipId] && current?.generatedClips.includes(clipId));
    if (!current || !complete) {
      setError('先に5種類のモーションを生成してください。');
      return;
    }
    setBusy(true);
    setBusyProgress(0.2, 'モーションZIPを準備しています');
    try {
      const archive = await createMotionBatchPackage(current, motions as MotionBatchResult);
      setBusyProgress(1, 'モーションZIPを作成しました');
      downloadBlob(archive, `content-studio-motions-${current.id.slice(0, 8)}.zip`);
    } catch (cause) {
      setError(humanError(cause, 'モーションZIPを作成できませんでした。'));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [motions, setBusyProgress]);

  const downloadMotionMetadata = useCallback(async () => {
    const current = draftRef.current;
    if (current && hasUnappliedImage(current) && current.publishedEdit?.mode!=='information') { setError(UNAPPLIED_IMAGE_MESSAGE); return; }
    const complete = MOTION_CLIP_IDS.every((clipId) => motions[clipId] && current?.generatedClips.includes(clipId));
    if (!current || !complete) {
      setError('先に5種類のモーションを生成してください。');
      return;
    }
    downloadBlob(new Blob([buildMotionBatchProfileJson(current, motions as MotionBatchResult)], { type: 'application/json' }), `motion-profile-${current.id.slice(0, 8)}.json`);
  }, [motions]);

  const downloadSpriteSheet = useCallback(async () => {
    const current = draftRef.current;
    if (!current || !sprite || !current.generatedClips.includes(selectedClip)) {
      setError('先にモーションを生成してください。');
      return;
    }
    downloadBlob(sprite.spriteSheetPng.blob, `${selectedClip}-sprite-${current.id.slice(0, 8)}.png`);
  }, [selectedClip, sprite]);

  const validateAndBuild = useCallback(async (): Promise<ValidationIssue[]> => {
    const current = draftRef.current;
    if (!current) return [];
    const inputKey = publicationInputKey(current);
    const epoch = contentEpochRef.current;
    if (bundleRef.current?.inputKey === inputKey) return bundleRef.current.issues;
    if(current.publishedEdit && publishedSnapshotRef.current && visualEditKey(current)===current.publishedEdit.visualKey) {
      try {
        const next=await buildInformationBundle(publishedSnapshotRef.current,current.character);
        if(epoch!==contentEpochRef.current || publicationInputKey(draftRef.current!)!==inputKey) throw new Error('編集中に内容が変わりました。');
        next.inputKey=inputKey;setBundle(next);return next.issues;
      }catch(cause){const issues:ValidationIssue[]=[{severity:'error',code:'published.information',message:humanError(cause,'情報編集を検証できません。')}];persistDraftState(d=>({...d,validation:issues}));return issues;}
    }
    if(hasUnappliedImage(current)) { const issues:ValidationIssue[]=[{severity:'error',code:'image.unapplied',message:UNAPPLIED_IMAGE_MESSAGE}];setBundle(null);persistDraftState(d=>({...d,validation:issues}));return issues; }
    if(current.publishedEdit?.mode==='information')return [{severity:'error',code:'published.input_required',message:'画像・動作を変更するには、編集入力の復元または明示的な画像選び直しが必要です。'}];
    let activeMotions = motions;
    if (!MOTION_CLIP_IDS.every((clipId) => activeMotions[clipId])) {
      activeMotions = await restoreMotionBatch(current.id,Boolean(current.publishedEdit));
      if (MOTION_CLIP_IDS.every((clipId) => activeMotions[clipId])) setMotions(activeMotions);
    }
    let activeSprite = activeMotions['move-forward'] ?? sprite;
    if (!activeSprite) {
      const storedSprite = await getDraftBlob(current.id, 'sprite');
      const metadata = await getAppMeta<SpriteMetadata>(`${current.id}:sprite-metadata`);
      if (storedSprite && metadata) {
        activeSprite = {
          spriteSheetPng: { blob: storedSprite, mimeType: 'image/png', width: metadata.frameWidth * metadata.frameCount, height: metadata.frameHeight, byteLength: storedSprite.size },
          sheet: { width: metadata.frameWidth * metadata.frameCount, height: metadata.frameHeight, data: new Uint8ClampedArray(0) },
          metadata,
          transforms: [],
          frameBounds: [],
          usedWorker: false,
        };
      }
    }
    const existing = publishedCharacters.map(({ character }) => ({ id: character.id, slug: character.slug }));
    const issues = [
      ...validateCharacter(current.character, { existing, current: current.sourceIdentity ?? undefined, includeLegacy: !current.legacyTargetId }),
      ...validationExtras(current, processed, activeMotions),
    ];
    persistDraftState((item) => ({ ...item, validation: issues }));
    if (issues.some(({ severity }) => severity === 'error')) {
      setBundle(null);
      return issues;
    }
    const normalizedPng = processed?.variants?.normalizedPng.blob ?? await getDraftBlob(current.id, 'normalized');
    const optimizedWebp = processed?.variants?.lightweightWebp.blob ?? await getDraftBlob(current.id, 'optimized');
    const iconPng = processed?.variants?.iconPng.blob ?? await getDraftBlob(current.id, 'icon');
    const thumbnailWebp = processed?.variants?.thumbnail.blob ?? await getDraftBlob(current.id, 'thumbnail');
    if (!normalizedPng || !optimizedWebp || !iconPng || !thumbnailWebp || !activeSprite || !MOTION_CLIP_IDS.every((clipId) => activeMotions[clipId])) {
      const missing: ValidationIssue = { severity: 'error', code: 'artifact.missing', message: '画像生成物が不足しています。切り抜きとモーションを再生成してください。' };
      const next = [...issues, missing];
      persistDraftState((item) => ({ ...item, validation: next }));
      return next;
    }
    try {
      const savedInput=await getAppMeta<{visualKey:string;editing:import('../generation/artifacts').BuildArtifactBundleInput['editing']}>(`${current.id}:editing-input`);
      const editing=savedInput?.visualKey===visualEditKey(current) ? savedInput.editing : processed ? await createEditingInput(current,processed.edited,hitProcessed?.edited,activeMotions as MotionBatchResult,await reusableEditingSources(current)) : undefined;
      const nextBundle = await buildArtifactBundle({
        editing,
        character: current.character,
        spriteMetadata: activeSprite.metadata,
        motionMetadata: Object.fromEntries(MOTION_CLIP_IDS.map((clipId) => [clipId, activeMotions[clipId]!.metadata])) as Record<MotionClipId, SpriteMetadata>,
        images: {
          normalizedPng,
          optimizedWebp,
          iconPng,
          thumbnailWebp,
          spriteSheetPng: activeSprite.spriteSheetPng.blob,
          motionSpriteSheets: Object.fromEntries(MOTION_CLIP_IDS.map((clipId) => [clipId, activeMotions[clipId]!.spriteSheetPng.blob])) as Record<MotionClipId, Blob>,
          previewPng: iconPng,
        },
        expectedBaseSha: repositoryStatus.baseSha,
        existingCanonicalRecords: publishedCharacters.filter(({ character }) => (
          !current.sourceIdentity || character.id !== current.sourceIdentity.id || character.slug !== current.sourceIdentity.slug
        )),
        currentCharacter: current.sourceIdentity ?? undefined,
        legacyTargetId: current.legacyTargetId ?? undefined,
      });
      if (epoch !== contentEpochRef.current || draftRef.current?.id !== current.id || publicationInputKey(draftRef.current) !== inputKey) throw new Error('編集中に内容が変わりました。現在の内容で再検証してください。');
      nextBundle.sourceRevision = current.publishedEdit?.revision;
      nextBundle.inputKey = inputKey;
      assertPublishSize(nextBundle.files, repositoryStatus.publishLimits);
      setBundle(nextBundle);
      return [...issues, ...nextBundle.issues];
    } catch (cause) {
      const generation: ValidationIssue = { severity: 'error', code: 'artifact.generation', message: humanError(cause, '生成ファイルを作成できませんでした。') };
      const next = [...issues, generation];
      persistDraftState((item) => ({ ...item, validation: next }));
      return next;
    }
  }, [hitProcessed, motions, persistDraftState, processed, publishedCharacters, repositoryStatus.baseSha, repositoryStatus.publishLimits, sprite]);

  const downloadZip = useCallback(async () => {
    let active = bundleRef.current;
    if (!active) {
      await validateAndBuild();
      active = bundleRef.current;
    }
    const latest = active ?? null;
    if (!latest) {
      setError('検証を完了してからZIPを出力してください。');
      return;
    }
    downloadBlob(await createArtifactZip(latest.files), `content-studio-${latest.character.slug}.zip`);
  }, [validateAndBuild]);

  const downloadJson = useCallback(async () => {
    const current = draftRef.current;
    if (!current) return;
    await autosaveRef.current.flush();
    downloadBlob(await exportDraftJson(current.id), `content-studio-draft-${current.character.slug || 'character'}.json`);
  }, []);

  const prepareChange = useCallback(async () => {
    if (publicationRef.current) return;
    publicationRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const issues = await validateAndBuild();
      if (issues.some(({ severity }) => severity === 'error')) throw new Error(issues.filter(issue=>issue.severity==='error').map(issue=>issue.message).join(' / '));
      const active = bundleRef.current;
      if (!active) throw new Error('生成物を準備できませんでした。もう一度検証してください。');
      const sourceDraft = draftRef.current;
      await autosaveRef.current.flush();
      const storedDraft = sourceDraft ? await getDraft(sourceDraft.id) : null;
      if (!storedDraft || active.inputKey !== publicationInputKey(storedDraft) || !draftRef.current || active.inputKey !== publicationInputKey(draftRef.current) || bundleRef.current !== active) throw new Error('公開する下書きの保存・内容照合を完了できません。下書きと生成物を保持して停止しました。');
      if(active.noChanges){
        if(repositoryStatus.mode==='server'){try{await gatewayRef.current.prepare(active);}catch(cause){if((cause as {code?:string}).code!=='no_changes')throw cause;}}
        setNotice('変更はありません。branch・commit・PRは作成しません。');return;
      }
      const now = new Date().toISOString();
      const recovery: OutboxRecord = { id: publicationOutboxId(active), draftId: draftRef.current!.id, bundle: active, actor: repositoryStatus.user, createdAt: now, updatedAt: now, attempts: 0, lastError: null };
      await putOutbox(recovery);
      const next = await gatewayRef.current.prepare(active, draftRef.current?.mockScenario);
      if (repositoryStatus.mode === 'server') active.recoveryBranch = next.branch;
      await putOutbox({ ...recovery, bundle: active, prepared: next, result: next.recovered });
      await refreshLists();
      if (bundleRef.current !== active || !draftRef.current || active.inputKey !== publicationInputKey(draftRef.current)) throw new Error('準備中に内容が変わりました。現在の内容で再検証してください。');
      setPrepared(next);
      setPullRequest(next.recovered ?? null);
      setNotice(repositoryStatus.mode === 'server' ? 'GitHubの基準snapshotで差分を再構成しました。内容を確認してください。CIはPR作成後に実行します。' : next.testStatus === 'success' ? 'モックコミットとテストが完了しました。' : 'テスト失敗を再現しました。');
    } catch (cause) {
      const message = humanError(cause, '公開準備に失敗しました。');
      setError(message);
      const current = draftRef.current;
      const active = bundleRef.current;
      if (current && active && !active.noChanges) {
        await putOutbox({ id: publicationOutboxId(active), draftId: current.id, bundle: active, actor: repositoryStatus.user, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), attempts: 0, lastError: message });
        await refreshLists();
      }
    } finally {
      publicationRef.current = false;
      setBusy(false);
    }
  }, [refreshLists, validateAndBuild, repositoryStatus]);

  const reprepareLatest = useCallback(async () => {
    if(publicationRef.current) return;
    const active=bundleRef.current;
    const current=draftRef.current;
    if(!active || !current || !prepared?.operationDigest || !pullRequest || pullRequest.merged) return;
    if(active.inputKey!==publicationInputKey(current)){setBundle(null);setError('内容が変わっています。現在の内容で再準備してください。');return;}
    publicationRef.current=true;setBusy(true);setError(null);
    try {
      const status=await gatewayRef.current.getStatus();
      if(!status.baseSha)throw new Error('最新masterを確認できません。');
      if(status.baseSha===prepared.commitSha){setNotice('この操作は最新masterを基準にしています。同じ操作の確認・再試行を利用できます。');return;}
      const nextBundle:ArtifactBundle={...active,recoveryBranch:undefined,revalidation:{branch:prepared.branch,headSha:pullRequest.commitSha,baseSha:prepared.commitSha,digest:prepared.operationDigest,targetBaseSha:status.baseSha}};
      const now=new Date().toISOString();
      const recovery:OutboxRecord={id:publicationOutboxId(nextBundle),draftId:current.id,bundle:nextBundle,actor:status.user,createdAt:now,updatedAt:now,attempts:0,lastError:null};
      await putOutbox(recovery);
      const next=await gatewayRef.current.prepare(nextBundle);
      nextBundle.recoveryBranch=next.branch;
      await putOutbox({...recovery,bundle:nextBundle,prepared:next,result:next.recovered});
      if(bundleRef.current!==active || !draftRef.current || active.inputKey!==publicationInputKey(draftRef.current))throw new Error('再検証中に内容が変わりました。保存した操作は保持しています。');
      setBundle(nextBundle);setPrepared(next);setPullRequest(next.recovered??null);
      setNotice('元のPRを保持し、同じ画像から最新masterの差分を作りました。新しい差分承認とCIが必要です。');
    } catch(cause){setError(humanError(cause,'最新masterでの再検証を停止しました。元PRと生成物は保持しています。'));}
    finally{publicationRef.current=false;setBusy(false);await refreshLists();}
  },[prepared,pullRequest,refreshLists,setBundle]);

  const createPullRequest = useCallback(async () => {
    if (publicationRef.current) return;
    const current = draftRef.current;
    if (!current || !bundle || !prepared) {
      setError('先に変更内容を準備してください。');
      return;
    }
    if (prepared.testStatus === 'failure') {
      setError('自動テストが失敗しています。PR作成前に修正してください。');
      return;
    }
    if (!bundle.inputKey || bundle.inputKey !== publicationInputKey(current)) { setBundle(null); setError('画面の内容が公開差分と一致しません。再準備してください。'); return; }
    const mergeRequested = current.publishMode === 'merge-after-ci';
    if (mergeRequested && !window.confirm('PRを作成し、CIがすべて成功した場合だけmasterへマージしますか？失敗や競合があれば自動で中断します。')) return;
    publicationRef.current = true;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      setBusyProgress(0.2, 'ブランチへpushしてPRを作成しています');
      let result = await gatewayRef.current.createPullRequest(prepared, bundle, current.mockScenario);
      const now = new Date().toISOString();
      const recovery = { id: publicationOutboxId(bundle), draftId: current.id, bundle, actor: repositoryStatus.user, prepared, result, createdAt: now, updatedAt: now, attempts: 0, lastError: null };
      await putOutbox(recovery);
      await refreshLists();
      if (bundleRef.current !== bundle || !draftRef.current || bundle.inputKey !== publicationInputKey(draftRef.current)) throw new Error('送信中に内容が変わりました。作成されたPRは復旧一覧に保持しています。');
      setPullRequest(result);
      if (mergeRequested && !result.merged) {
        let checks: RepositoryStatus['build'] = result.checks;
        for (let attempt = 0; checks !== 'success'; attempt += 1) {
          if (checks === 'failure') throw new Error('CIが失敗したためPRはマージしていません。PR上で結果を確認してください。');
          if (attempt >= 75) throw new Error('CIの完了待ちが10分を超えました。PRは作成済みですがマージしていません。');
          setBusyProgress(Math.min(0.75, 0.3 + attempt * 0.006), `CI完了を待っています（${checks}）`);
          await waitFor(8_000, controller.signal);
          checks = await gatewayRef.current.getChecks(result.commitSha);
        }
        setBusyProgress(0.82, 'CI成功を確認しました。競合を再確認してマージします');
        if (bundleRef.current !== bundle || !draftRef.current || bundle.inputKey !== publicationInputKey(draftRef.current)) throw new Error('CI待機中に内容が変わったためマージを停止しました。');
        result = await gatewayRef.current.mergePullRequest(prepared, { ...result, checks: 'success' }, current.mockScenario);
        setPullRequest(result);
        await putOutbox({ ...recovery, result });
      }
      setBusyProgress(1, result.merged ? 'マージが完了しました' : 'PRを作成しました');
      await addPublishHistory({
        id: crypto.randomUUID(),
        draftId: current.id,
        characterId: current.character.id,
        displayName: current.character.displayName,
        completedAt: new Date().toISOString(),
        result,
      });
      persistDraftState((item) => ({ ...item, lastStep: 'publish', historyStatus: 'clean' }));
      setNotice(result.merged ? 'PRを作成し、CI成功後に安全にマージしました。' : 'PRを作成しました。内容を確認してからマージできます。');
      await refreshLists();
    } catch (cause) {
      setError(humanError(cause, 'PRを作成できませんでした。'));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      publicationRef.current = false;
      setBusy(false);
      setProgress(null);
    }
  }, [bundle, persistDraftState, prepared, refreshLists, setBusyProgress, repositoryStatus]);

  const retryOutbox = useCallback(async (id: string) => {
    if (publicationRef.current) return;
    const item = outbox.find(candidate => candidate.id === id);
    const epoch=contentEpochRef.current;
    if (!item) return;
    publicationRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const status = await gatewayRef.current.getStatus();
      if (status.mode === 'server' && (!status.connected || (item.actor && item.actor !== status.user))) throw new Error('保存時と同じGitHubアカウントで再ログインしてください。');
      const stored = await getDraft(item.draftId);
      if (!stored || !item.bundle.inputKey || item.bundle.inputKey !== publicationInputKey(stored)) throw new Error('保存した下書きと公開操作の対応を確認できません。下書き・生成物・既存PRは保持しています。現在の内容で再準備してください。');
      const next = await gatewayRef.current.prepare(item.bundle, 'success');
      if (item.result && next.recovered && item.result.commitSha !== next.recovered.commitSha) throw new Error('保存したPRのheadが変わっています。再開を停止しました。');
      if (status.mode === 'server') item.bundle.recoveryBranch = next.branch;
      if (epoch !== contentEpochRef.current) throw new Error('復旧中に別の作業へ移動しました。保存した操作は保持しています。');
      const opening = openDraft(item.draftId);
      const openingEpoch = contentEpochRef.current;
      await opening;
      if (openingEpoch !== contentEpochRef.current || draftRef.current?.id !== item.draftId || item.bundle.inputKey !== publicationInputKey(draftRef.current)) throw new Error('復旧中に下書きが変わりました。保存した操作は保持しています。');
      setBundle(item.bundle);
      setPrepared(next);
      setPullRequest(next.recovered ?? item.result ?? null);
      goToStep('publish');
      await putOutbox({ ...item, prepared: next, result: next.recovered ?? item.result, attempts: item.attempts + 1, lastError: null });
      setNotice(next.recovered ? '既存PRを確認しました。最新の差分・CI・配備状況を確認できます。' : '生成物を復旧しました。差分を確認して同じ公開操作を続けられます。');
      await refreshLists();
    } catch (cause) {
      const message = humanError(cause, '公開操作の復旧に失敗しました。');
      await putOutbox({ ...item, attempts: item.attempts + 1, lastError: message });
      setError(message);
      await refreshLists();
    } finally { publicationRef.current = false; setBusy(false); }
  }, [outbox, refreshLists, openDraft, goToStep]);

  const duplicateExistingDraft = useCallback(async (id: string) => {
    const duplicate = await duplicateDraft(id);
    await refreshLists();
    await openDraft(duplicate.id);
  }, [openDraft, refreshLists]);

  const deleteExistingDraft = useCallback(async (id: string) => {
    try {
      await deleteDraft(id);
      if(draftRef.current?.id===id){
        contentEpochRef.current++;abortRef.current?.abort();hitAbortRef.current?.abort();autosaveRef.current.cancel();
        draftRef.current=null;originalBlobRef.current=null;hitOriginalBlobRef.current=null;publishedSnapshotRef.current=null;
        setDraft(null);setProcessed(null);setHitProcessed(null);setMotions({});setSprite(null);setBundle(null);setView('dashboard');setSaveState('idle');
      }
      await refreshLists();setNotice('下書きと、その下書きが所有する画像・編集データを削除しました。');
    } catch(cause) {setError(humanError(cause,'下書きを削除できません。保存データを保持しています。'));}
  }, [refreshLists,setBundle]);

  const importDraft = useCallback(async (file: Blob) => {
    try {
      const imported = await importDraftJson(file);
      await refreshLists();
      await openDraft(imported.id);
    } catch (cause) {
      setError(humanError(cause, '下書きを読み込めませんでした。'));
    }
  }, [openDraft, refreshLists]);

  const exportDraft = useCallback(async (id?: string) => {
    const target = id ?? draftRef.current?.id;
    if (!target) return;
    await autosaveRef.current.flush();
    const blob = await exportDraftJson(target);
    downloadBlob(blob, `content-studio-draft-${target.slice(0, 8)}.json`);
  }, []);

  const logout = useCallback(async () => {
    await gatewayRef.current.logout();
    await refreshRepositoryStatus();
  }, [refreshRepositoryStatus]);

  const login = useCallback(() => {
    const gateway = gatewayRef.current;
    if (gateway instanceof ServerRepositoryGateway) {
      gateway.beginLogin(`${location.pathname}${location.search}${location.hash}`);
      return;
    }
    setNotice('モックモードでは管理者として接続済みです。');
  }, []);

  const installApp = useCallback(async () => {
    if (!installEvent) {
      setNotice('Chromeのメニューから「アプリをインストール」を選んでください。');
      return;
    }
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    setNotice(choice.outcome === 'accepted' ? 'インストールを開始しました。' : 'インストールは後からChromeメニューで実行できます。');
    setInstallEvent(null);
  }, [installEvent]);

  const step = draft?.lastStep ?? 'image';
  const stepIndex = Math.max(0, WORKFLOW_STEPS.findIndex(({ id }) => id === step));
  const nextStep = useCallback(() => {
    if (!draftRef.current) return;
    const index = WORKFLOW_STEPS.findIndex(({ id }) => id === draftRef.current!.lastStep);
    if (index < WORKFLOW_STEPS.length - 1) goToStep(WORKFLOW_STEPS[index + 1].id);
  }, [goToStep]);
  const previousStep = useCallback(() => {
    if (!draftRef.current) return;
    const index = WORKFLOW_STEPS.findIndex(({ id }) => id === draftRef.current!.lastStep);
    if (index > 0) goToStep(WORKFLOW_STEPS[index - 1].id);
    else void backToDashboard();
  }, [backToDashboard, goToStep]);

  const value = useMemo<StudioController>(() => ({
    appVersion, view, step, stepIndex, draft, drafts, publishedCharacters, publishedWarning, history, outbox, processed, hitProcessed, sprite, motions, selectedClip, bundle, prepared, pullRequest,
    repositoryStatus, capabilities, storage, saveState, savedAt, busy, progress, error, notice, redoCount: redo.length,
    installAvailable: Boolean(installEvent), installApp, dismissNotice: () => setNotice(null), dismissError: () => setError(null),
    publishedEditingAvailable: publishedSnapshotRef.current?.record.editing?.generatorVersion === GENERATOR_VERSION,
    createNewDraft, editLegacyCharacter, editPublishedCharacter, enablePublishedRegeneration, openDraft, backToDashboard, duplicateExistingDraft, deleteExistingDraft, importDraft, exportDraft, updateDraft,
    goToStep, nextStep, previousStep, acceptFile, onFileInput, onHitFileInput, removeHitImage, onDrop, applyImageOperations, autoRemoveBackground, autoTrim,
    addBrushStroke, undoImageOperation, redoImageOperation, detectParts, detectLandmarks, selectMotionClip, setMotionIntensity, generateMotion,
    downloadMotionZip, downloadMotionMetadata, downloadSpriteSheet, validateAndBuild, downloadZip, downloadJson,
    prepareChange, reprepareLatest, createPullRequest, retryOutbox, refreshRepositoryStatus, refreshPublishedContent, login, logout,
    cancelProcessing: () => {
      if(publishedLoadingRef.current){contentEpochRef.current++;setBusy(false);setNotice('公開読込を中止しました。現在の下書きを保持しています。');}
      if (publicationRef.current) setNotice('待機を終了します。送信済みのPR作成・マージは取り消されません。「既存PRを確認・再開」で結果を確認してください。');
      abortRef.current?.abort();
      hitAbortRef.current?.abort();
    },
  }), [
    acceptFile, addBrushStroke, appVersion, applyImageOperations, autoRemoveBackground, autoTrim, backToDashboard, bundle, busy,
    capabilities, createNewDraft, createPullRequest, deleteExistingDraft, downloadJson, downloadZip, draft, drafts, editLegacyCharacter, editPublishedCharacter, enablePublishedRegeneration,
    detectLandmarks, detectParts, downloadMotionMetadata, downloadMotionZip, downloadSpriteSheet, duplicateExistingDraft, error, exportDraft, generateMotion, goToStep, history, importDraft, installApp, installEvent,
    nextStep, notice, onDrop, onFileInput, onHitFileInput, openDraft, outbox, prepareChange, reprepareLatest, prepared, previousStep, processed, hitProcessed, progress, removeHitImage,
    pullRequest, redo.length, redoImageOperation, refreshRepositoryStatus, refreshPublishedContent, repositoryStatus, retryOutbox, saveState, savedAt,
    motions, publishedCharacters, publishedWarning, selectedClip, selectMotionClip, setMotionIntensity, sprite, step, stepIndex, storage, undoImageOperation, updateDraft, validateAndBuild, view, login, logout,
  ]);

  return value;
}

export const REGISTERED_LEGACY_CHARACTER_COUNT = LEGACY_CHARACTERS.length;
