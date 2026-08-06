import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { createDraft } from '../domain/defaults';
import { LEGACY_CHARACTERS, spriteMetadataSchema, validateCharacter } from '../domain';
import type {
  ArtifactBundle,
  DraftRecord,
  ImageOperation,
  MockScenario,
  MotionClipId,
  PreparedChange,
  PullRequestResult,
  RepositoryGateway,
  RepositoryStatus,
  SpriteMetadata,
  ValidationIssue,
  WorkflowStep,
} from '../domain/types';
import { WORKFLOW_STEPS } from '../domain/types';
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
  generateMotionBatch,
  generateIdleMotionFromBlob,
  MOTION_CLIP_IDS,
  type EncodedIdleSpriteResult,
  type MotionBatchResult,
  type MotionProgress,
} from '../motion';
import { acquireWakeLock, detectCapabilities, requestPersistentStorage, storageUsage, type Capabilities } from '../pwa/capabilities';
import { consumeSharedImage } from '../pwa/share-target';
import { fetchPublishedImage, loadPublishedContent } from '../game/published-content';
import {
  addPublishHistory,
  deleteDraftBlob,
  deleteDraft,
  deleteOutbox,
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
  editPublishedCharacter(slug: string): Promise<void>;
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
  generateMotion(): Promise<void>;
  downloadMotionZip(): Promise<void>;
  downloadMotionMetadata(): Promise<void>;
  downloadSpriteSheet(): Promise<void>;
  validateAndBuild(): Promise<ValidationIssue[]>;
  downloadZip(): Promise<void>;
  downloadJson(): Promise<void>;
  prepareChange(): Promise<void>;
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
  const missingClips = MOTION_CLIP_IDS.filter((clipId) => !motions[clipId]);
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

async function restoreStoredMotion(draftId: string, clipId: MotionClipId): Promise<EncodedIdleSpriteResult | null> {
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
    const sheet = await decodeImageBlob(blob, safety);
    if (sheet.width !== sheetWidth || sheet.height !== metadata.frameHeight) return null;
    return {
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

async function restoreMotionBatch(draftId: string): Promise<Partial<MotionBatchResult>> {
  const entries = await Promise.all(MOTION_CLIP_IDS.map(async (clipId) => [clipId, await restoreStoredMotion(draftId, clipId)] as const));
  return Object.fromEntries(entries.filter((entry): entry is readonly [MotionClipId, EncodedIdleSpriteResult] => entry[1] !== null));
}

export function useStudioController(): StudioController {
  const appVersion = import.meta.env.VITE_APP_VERSION || '0.4.2';
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
  const [publishedWarning, setPublishedWarning] = useState<string | null>(null);
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

  const setBundle = useCallback((next: ArtifactBundle | null) => {
    bundleRef.current = next;
    setBundleState(next);
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
    setDraft((current) => {
      if (!current) return current;
      const next = updater(structuredClone(current));
      next.updatedAt = new Date().toISOString();
      draftRef.current = next;
      setSaveState('pending');
      autosaveRef.current.schedule(next);
      return next;
    });
  }, []);

  const refreshRepositoryStatus = useCallback(async () => {
    try {
      setRepositoryStatus(await gatewayRef.current.getStatus());
    } catch (cause) {
      setRepositoryStatus({ ...EMPTY_REPOSITORY_STATUS, connected: false, message: humanError(cause, 'GitHub状態を確認できませんでした。') });
    }
  }, []);

  useEffect(() => {
    void refreshLists();
    void refreshRepositoryStatus();
    void loadPublishedContent().then(({ records, warning }) => {
      setPublishedCharacters(records);
      setPublishedWarning(warning);
    });
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
  }, [refreshLists, refreshRepositoryStatus]);

  const updateDraft = useCallback((updater: (current: DraftRecord) => DraftRecord) => {
    setDraft((current) => {
      if (!current) return current;
      const next = updater(structuredClone(current));
      next.updatedAt = new Date().toISOString();
      next.historyStatus = 'dirty';
      draftRef.current = next;
      setSaveState('pending');
      autosaveRef.current.schedule(next);
      setBundle(null);
      setPrepared(null);
      setPullRequest(null);
      return next;
    });
  }, []);

  const goToStep = useCallback((step: WorkflowStep, replace = false) => {
    persistDraftState((current) => ({ ...current, lastStep: step }));
    const method = replace ? 'replaceState' : 'pushState';
    window.history[method]({ studio: true, step }, '', `#${step}`);
  }, [persistDraftState]);

  const openDraft = useCallback(async (id: string) => {
    await autosaveRef.current.flush();
    const stored = await getDraft(id);
    if (!stored) {
      setError('下書きが見つかりませんでした。');
      return;
    }
    const [original, hitOriginal, restoredSprite, restoredMotions] = await Promise.all([
      getDraftBlob(id, 'original'),
      getDraftBlob(id, 'hit-original'),
      restoreStoredSprite(id),
      restoreMotionBatch(id),
    ]);
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
    if (original || hitOriginal) {
      setNotice('下書きを復旧しました。画像プレビューを再構築しています。');
      setTimeout(() => void (async () => {
        if (original) await rebuildImage(stored, original, false);
        if (hitOriginal) await rebuildHitImage(stored, hitOriginal, false);
      })().catch(() => undefined), 0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createNewDraft = useCallback(async () => {
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
        updateDraft((item) => ({ ...item, lastStep: WORKFLOW_STEPS[index - 1].id }));
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

  const rebuildImage = useCallback(async (snapshot: DraftRecord, source: Blob, generateVariants: boolean, operations = snapshot.processingOperations) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
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
          onProgress: (item: ImageProgress) => setBusyProgress(item.progress, item.message),
        },
      );
      setProcessed(result);
      if (generateVariants) {
        setSprite(null);
        setMotions({});
      }
      const imageInfo = { ...result.info, fileName: snapshot.imageInfo?.fileName || result.info.fileName, status: 'ready' as const };
      const landmarks = snapshot.landmarks.status === 'idle'
        ? detectMotionLandmarks(result.normalized.pixels, snapshot.landmarks.facing)
        : snapshot.landmarks;
      updateDraft((current) => ({ ...current, imageInfo, processingOperations: operations, landmarks, generatedClips: generateVariants ? [] : current.generatedClips }));
      if (result.variants) {
        await Promise.all([
          putDraftBlob(snapshot.id, 'working', await encodePixelBuffer(result.edited, 'image/png').then(({ blob }) => blob)),
          putDraftBlob(snapshot.id, 'normalized', result.variants.normalizedPng.blob),
          putDraftBlob(snapshot.id, 'optimized', result.variants.lightweightWebp.blob),
          putDraftBlob(snapshot.id, 'icon', result.variants.iconPng.blob),
          putDraftBlob(snapshot.id, 'thumbnail', result.variants.thumbnail.blob),
          setAppMeta(`${snapshot.id}:sprite-metadata`, null),
          ...MOTION_CLIP_IDS.map((clipId) => setAppMeta(`${snapshot.id}:motion:${clipId}:metadata`, null)),
        ]);
      }
      return result;
    } catch (cause) {
      setError(humanError(cause, '画像処理に失敗しました。画質を下げて再試行してください。'));
      throw cause;
    } finally {
      await wakeLock?.release().catch(() => undefined);
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
      setProgress(null);
    }
  }, [setBusyProgress, updateDraft]);

  const rebuildHitImage = useCallback(async (snapshot: DraftRecord, source: Blob, invalidateMotion: boolean) => {
    hitAbortRef.current?.abort();
    const controller = new AbortController();
    hitAbortRef.current = controller;
    setBusy(true);
    setError(null);
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
        onProgress: (item: ImageProgress) => setBusyProgress(item.progress, `被弾用: ${item.message}`),
      },
    );
    try {
      let result = await process(false);
      if (!result.analysis.hasAlpha && result.analysis.isLikelySolidBackground) {
        setBusyProgress(0.36, '被弾用画像の単色背景を除去しています');
        result = await process(true);
      }
      setHitProcessed(result);
      const hitImageInfo = {
        ...result.info,
        fileName: snapshot.hitImageInfo?.fileName || result.info.fileName,
        status: 'ready' as const,
      };
      persistDraftState((current) => current.id === snapshot.id
        ? { ...current, hitImageInfo, generatedClips: invalidateMotion ? [] : current.generatedClips }
        : current);
      if (invalidateMotion) {
        setMotions({});
        setSprite(null);
        await Promise.all(MOTION_CLIP_IDS.map((clipId) => setAppMeta(`${snapshot.id}:motion:${clipId}:metadata`, null)));
      }
      return result;
    } catch (cause) {
      setError(humanError(cause, '被弾用画像を処理できませんでした。別の画像で再試行してください。'));
      throw cause;
    } finally {
      await wakeLock?.release().catch(() => undefined);
      if (hitAbortRef.current === controller) hitAbortRef.current = null;
      setBusy(false);
      setProgress(null);
    }
  }, [persistDraftState, setBusyProgress]);

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
    originalBlobRef.current = file;
    await putDraftBlob(current.id, 'original', file);
    const next: DraftRecord = {
      ...current,
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
    const current = draftRef.current;
    if (!current) return;
    if (!ALLOWED_FILE_TYPES.has(file.type)) {
      setError('被弾用画像はPNG、JPEG、WebPのいずれかを選んでください。');
      return;
    }
    if (file.size <= 0 || file.size > MAX_INPUT_BYTES) {
      setError('被弾用画像は20MB以下にしてください。');
      return;
    }
    hitOriginalBlobRef.current = file;
    await putDraftBlob(current.id, 'hit-original', file);
    const next: DraftRecord = {
      ...current,
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
      generatedClips: [],
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
      ...MOTION_CLIP_IDS.map((clipId) => setAppMeta(`${current.id}:motion:${clipId}:metadata`, null)),
    ]);
    setMotions({});
    setSprite(null);
    persistDraftState((active) => active.id === current.id
      ? { ...active, hitImageInfo: null, generatedClips: [] }
      : active);
    setNotice('被弾用画像を外しました。次回生成は通常画像を使います。');
  }, [persistDraftState]);

  const onDrop = useCallback(async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) await acceptFile(file);
  }, [acceptFile]);

  const editPublishedCharacter = useCallback(async (slug: string) => {
    const record = publishedCharacters.find((item) => item.character.slug === slug);
    if (!record) {
      setError('公開済みキャラクターが見つかりませんでした。');
      return;
    }
    try {
      await autosaveRef.current.flush();
      const next = createDraft();
      next.title = `${record.character.displayName}を更新`;
      next.character = structuredClone(record.character);
      next.sourceIdentity = { id: record.character.id, slug: record.character.slug };
      next.motionPreset = record.spriteMetadata.preset;
      next.motion = structuredClone(record.spriteMetadata.motionParameters);
      next.lastStep = 'image';
      const saved = await saveDraft(next);
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
      const file = await fetchPublishedImage(record);
      await acceptFile(file);
      setNotice('公開済みデータを更新用の下書きへ読み込みました。');
      await refreshLists();
    } catch (cause) {
      setError(humanError(cause, '公開済みキャラクターを読み込めませんでした。'));
    }
  }, [acceptFile, publishedCharacters, refreshLists, setBundle]);

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

  const generateMotion = useCallback(async () => {
    const current = draftRef.current;
    const source = processed?.edited;
    if (!current || !source) {
      setError('先に画像を切り抜いて正規化してください。');
      return;
    }
    if (current.hitImageInfo && !hitProcessed) {
      setError('被弾用画像を復旧できていません。画像ステップで選び直すか、被弾用画像を外してください。');
      return;
    }
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
      const result = await generateMotionBatch({
        source,
        hitSource: hitProcessed?.edited,
        sourceImage: 'normalized.png',
        landmarks,
        outputSize: current.motion.outputSize,
        sourcePlacement: {
          padding: current.editor.padding,
          offsetX: current.editor.offsetX,
          offsetY: current.editor.offsetY,
          scale: current.editor.scale,
          flipHorizontal: current.editor.flipHorizontal,
          referenceSize: current.editor.outputSize,
        },
      }, {
        signal: controller.signal,
        onProgress: (item) => setBusyProgress(item.progress, item.message),
      });
      const active = result['move-forward'];
      setMotions(result);
      setSelectedClip('move-forward');
      setSprite(active);
      await Promise.all([
        putDraftBlob(current.id, 'sprite', active.spriteSheetPng.blob),
        setAppMeta(`${current.id}:sprite-metadata`, active.metadata),
        ...MOTION_CLIP_IDS.flatMap((clipId) => [
          putDraftBlob(current.id, MOTION_BLOB_KIND[clipId], result[clipId].spriteSheetPng.blob),
          setAppMeta(`${current.id}:motion:${clipId}:metadata`, result[clipId].metadata),
        ]),
      ]);
      persistDraftState((draftItem) => draftItem.id === current.id
        ? {
          ...draftItem,
          landmarks,
          generatedClips: [...MOTION_CLIP_IDS],
          preview: { ...draftItem.preview, playing: true },
        }
        : draftItem);
      const usedWorker = MOTION_CLIP_IDS.every((clipId) => result[clipId].usedWorker);
      setNotice(usedWorker
        ? '前進・後退・単発砲撃・被弾・着地の5種類を高画質で生成しました。'
        : 'Worker未対応のため、端末を固めない軽量画質で5種類を生成しました。');
    } catch (cause) {
      setError(humanError(cause, '5種類のモーションを生成できませんでした。'));
    } finally {
      await wakeLock?.release().catch(() => undefined);
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
      setProgress(null);
    }
  }, [hitProcessed, persistDraftState, processed, setBusyProgress]);

  const downloadMotionZip = useCallback(async () => {
    const current = draftRef.current;
    const complete = MOTION_CLIP_IDS.every((clipId) => motions[clipId]);
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
    const complete = MOTION_CLIP_IDS.every((clipId) => motions[clipId]);
    if (!current || !complete) {
      setError('先に5種類のモーションを生成してください。');
      return;
    }
    downloadBlob(new Blob([buildMotionBatchProfileJson(current, motions as MotionBatchResult)], { type: 'application/json' }), `motion-profile-${current.id.slice(0, 8)}.json`);
  }, [motions]);

  const downloadSpriteSheet = useCallback(async () => {
    const current = draftRef.current;
    if (!current || !sprite) {
      setError('先にモーションを生成してください。');
      return;
    }
    downloadBlob(sprite.spriteSheetPng.blob, `${selectedClip}-sprite-${current.id.slice(0, 8)}.png`);
  }, [selectedClip, sprite]);

  const validateAndBuild = useCallback(async (): Promise<ValidationIssue[]> => {
    const current = draftRef.current;
    if (!current) return [];
    let activeMotions = motions;
    if (!MOTION_CLIP_IDS.every((clipId) => activeMotions[clipId])) {
      activeMotions = await restoreMotionBatch(current.id);
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
      ...validateCharacter(current.character, { existing, current: current.sourceIdentity ?? undefined }),
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
      const nextBundle = await buildArtifactBundle({
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
      });
      setBundle(nextBundle);
      return [...issues, ...nextBundle.issues];
    } catch (cause) {
      const generation: ValidationIssue = { severity: 'error', code: 'artifact.generation', message: humanError(cause, '生成ファイルを作成できませんでした。') };
      const next = [...issues, generation];
      persistDraftState((item) => ({ ...item, validation: next }));
      return next;
    }
  }, [motions, persistDraftState, processed, publishedCharacters, repositoryStatus.baseSha, sprite]);

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
    downloadBlob(await exportDraftJson(current.id), `content-studio-draft-${current.character.slug || 'character'}.json`);
  }, []);

  const prepareChange = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const issues = await validateAndBuild();
      if (issues.some(({ severity }) => severity === 'error')) throw new Error('検証エラーを修正してから公開準備を実行してください。');
      const active = bundleRef.current;
      if (!active) throw new Error('生成物を準備できませんでした。もう一度検証してください。');
      const next = await gatewayRef.current.prepare(active, draftRef.current?.mockScenario);
      setPrepared(next);
      setNotice(next.testStatus === 'success' ? 'モックコミットとテストが完了しました。' : 'テスト失敗を再現しました。');
    } catch (cause) {
      const message = humanError(cause, '公開準備に失敗しました。');
      setError(message);
      const current = draftRef.current;
      const active = bundleRef.current;
      if (current && active && (!navigator.onLine || current.mockScenario === 'network-offline')) {
        await putOutbox({ id: crypto.randomUUID(), draftId: current.id, bundle: active, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), attempts: 0, lastError: message });
        await refreshLists();
      }
    } finally {
      setBusy(false);
    }
  }, [refreshLists, validateAndBuild]);

  const createPullRequest = useCallback(async () => {
    const current = draftRef.current;
    if (!current || !bundle || !prepared) {
      setError('先に変更内容を準備してください。');
      return;
    }
    if (prepared.testStatus === 'failure') {
      setError('自動テストが失敗しています。PR作成前に修正してください。');
      return;
    }
    const mergeRequested = current.publishMode === 'merge-after-ci';
    if (mergeRequested && !window.confirm('PRを作成し、CIがすべて成功した場合だけmasterへマージしますか？失敗や競合があれば自動で中断します。')) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      setBusyProgress(0.2, 'ブランチへpushしてPRを作成しています');
      let result = await gatewayRef.current.createPullRequest(prepared, bundle, current.mockScenario);
      setPullRequest(result);
      if (mergeRequested) {
        let checks: RepositoryStatus['build'] = result.checks;
        for (let attempt = 0; checks !== 'success'; attempt += 1) {
          if (checks === 'failure') throw new Error('CIが失敗したためPRはマージしていません。PR上で結果を確認してください。');
          if (attempt >= 75) throw new Error('CIの完了待ちが10分を超えました。PRは作成済みですがマージしていません。');
          setBusyProgress(Math.min(0.75, 0.3 + attempt * 0.006), `CI完了を待っています（${checks}）`);
          await waitFor(8_000, controller.signal);
          checks = await gatewayRef.current.getChecks(result.commitSha);
        }
        setBusyProgress(0.82, 'CI成功を確認しました。競合を再確認してマージします');
        result = await gatewayRef.current.mergePullRequest(prepared, { ...result, checks: 'success' }, current.mockScenario);
        setPullRequest(result);
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
      setBusy(false);
      setProgress(null);
    }
  }, [bundle, persistDraftState, prepared, refreshLists, setBusyProgress]);

  const retryOutbox = useCallback(async (id: string) => {
    const item = outbox.find((candidate) => candidate.id === id);
    if (!item) return;
    setBusy(true);
    try {
      const next = await gatewayRef.current.prepare(item.bundle, 'success');
      await deleteOutbox(id);
      setPrepared(next);
      setBundle(item.bundle);
      setNotice('未送信の変更を再送しました。PR作成へ進めます。');
      await refreshLists();
    } catch (cause) {
      await putOutbox({ ...item, attempts: item.attempts + 1, lastError: humanError(cause, '再送に失敗しました。'), updatedAt: new Date().toISOString() });
      setError(humanError(cause, '再送に失敗しました。'));
      await refreshLists();
    } finally {
      setBusy(false);
    }
  }, [outbox, refreshLists]);

  const duplicateExistingDraft = useCallback(async (id: string) => {
    const duplicate = await duplicateDraft(id);
    await refreshLists();
    await openDraft(duplicate.id);
  }, [openDraft, refreshLists]);

  const deleteExistingDraft = useCallback(async (id: string) => {
    await deleteDraft(id);
    await refreshLists();
  }, [refreshLists]);

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
    createNewDraft, editPublishedCharacter, openDraft, backToDashboard, duplicateExistingDraft, deleteExistingDraft, importDraft, exportDraft, updateDraft,
    goToStep, nextStep, previousStep, acceptFile, onFileInput, onHitFileInput, removeHitImage, onDrop, applyImageOperations, autoRemoveBackground, autoTrim,
    addBrushStroke, undoImageOperation, redoImageOperation, detectParts, detectLandmarks, selectMotionClip, generateMotion,
    downloadMotionZip, downloadMotionMetadata, downloadSpriteSheet, validateAndBuild, downloadZip, downloadJson,
    prepareChange, createPullRequest, retryOutbox, refreshRepositoryStatus, login, logout,
    cancelProcessing: () => {
      abortRef.current?.abort();
      hitAbortRef.current?.abort();
    },
  }), [
    acceptFile, addBrushStroke, appVersion, applyImageOperations, autoRemoveBackground, autoTrim, backToDashboard, bundle, busy,
    capabilities, createNewDraft, createPullRequest, deleteExistingDraft, downloadJson, downloadZip, draft, drafts, editPublishedCharacter,
    detectLandmarks, detectParts, downloadMotionMetadata, downloadMotionZip, downloadSpriteSheet, duplicateExistingDraft, error, exportDraft, generateMotion, goToStep, history, importDraft, installApp, installEvent,
    nextStep, notice, onDrop, onFileInput, onHitFileInput, openDraft, outbox, prepareChange, prepared, previousStep, processed, hitProcessed, progress, removeHitImage,
    pullRequest, redo.length, redoImageOperation, refreshRepositoryStatus, repositoryStatus, retryOutbox, saveState, savedAt,
    motions, publishedCharacters, publishedWarning, selectedClip, selectMotionClip, sprite, step, stepIndex, storage, undoImageOperation, updateDraft, validateAndBuild, view, login, logout,
  ]);

  return value;
}

export const REGISTERED_LEGACY_CHARACTER_COUNT = LEGACY_CHARACTERS.length;
