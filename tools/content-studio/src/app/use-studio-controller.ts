import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { createDraft } from '../domain/defaults';
import { LEGACY_CHARACTERS, spriteMetadataSchema, validateCharacter } from '../domain';
import type {
  ArtifactBundle,
  DraftRecord,
  ImageOperation,
  MockScenario,
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
import { generateIdleMotionFromBlob, type EncodedIdleSpriteResult, type MotionProgress } from '../motion';
import { acquireWakeLock, detectCapabilities, requestPersistentStorage, storageUsage, type Capabilities } from '../pwa/capabilities';
import { consumeSharedImage } from '../pwa/share-target';
import { fetchPublishedImage, loadPublishedContent } from '../game/published-content';
import {
  addPublishHistory,
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
  sprite: EncodedIdleSpriteResult | null;
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
  onDrop(event: DragEvent<HTMLElement>): Promise<void>;
  applyImageOperations(operations?: ImageOperation[]): Promise<void>;
  autoRemoveBackground(): Promise<void>;
  autoTrim(): Promise<void>;
  addBrushStroke(operation: Extract<ImageOperation, { type: 'brush' }>): Promise<void>;
  undoImageOperation(): Promise<void>;
  redoImageOperation(): Promise<void>;
  generateMotion(): Promise<void>;
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

function validationExtras(draft: DraftRecord, processed: ProcessedImage | null, sprite: EncodedIdleSpriteResult | null): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!draft.imageInfo || !processed) issues.push({ severity: 'error', code: 'image.missing', field: 'image', message: 'キャラクター画像を登録してください。' });
  if (draft.imageInfo && draft.imageInfo.byteLength > MAX_INPUT_BYTES) issues.push({ severity: 'error', code: 'image.too_large', field: 'image', message: '元画像は20MB以下にしてください。' });
  if (!sprite) issues.push({ severity: 'error', code: 'motion.missing', field: 'motion', message: '待機モーションを生成してください。' });
  if (processed?.analysis.hasBakedCheckerboard) issues.push({ severity: 'warning', code: 'image.checkerboard', field: 'image', message: '市松模様が焼き付いている可能性があります。透明表示で輪郭を確認してください。' });
  if (processed?.analysis.hasBakedBlackBackground) issues.push({ severity: 'warning', code: 'image.black_background', field: 'image', message: '黒背景が焼き付いている可能性があります。' });
  if (draft.character.specialTemplate === 'custom-required') issues.push({ severity: 'warning', code: 'skill.custom_required', field: 'specialTemplate', message: 'カスタム実装が必要です。自動登録せずPR本文へ仕様メモを出力します。' });
  if (draft.character.specialTemplate === 'custom-required' && !draft.character.customImplementationNote.trim()) issues.push({ severity: 'error', code: 'skill.custom_note_missing', field: 'customImplementationNote', message: 'カスタム実装の仕様メモを入力してください。' });
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

export function useStudioController(): StudioController {
  const appVersion = import.meta.env.VITE_APP_VERSION || '0.1.1';
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
  const [sprite, setSprite] = useState<EncodedIdleSpriteResult | null>(null);
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
  const abortRef = useRef<AbortController | null>(null);
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
    const [original, restoredSprite] = await Promise.all([
      getDraftBlob(id, 'original'),
      restoreStoredSprite(id),
    ]);
    originalBlobRef.current = original;
    setDraft(stored);
    draftRef.current = stored;
    setProcessed(null);
    setSprite(restoredSprite);
    setBundle(null);
    setPrepared(null);
    setPullRequest(null);
    setRedo([]);
    setView('workflow');
    setSavedAt(stored.updatedAt);
    setSaveState('saved');
    window.history.pushState({ studio: true, step: stored.lastStep }, '', `#${stored.lastStep}`);
    if (original) {
      setNotice('下書きを復旧しました。画像プレビューを再構築しています。');
      setTimeout(() => void rebuildImage(stored, original, false), 0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createNewDraft = useCallback(async () => {
    await autosaveRef.current.flush();
    const next = createDraft();
    const saved = await saveDraft(next);
    originalBlobRef.current = null;
    setDraft(saved);
    draftRef.current = saved;
    setProcessed(null);
    setSprite(null);
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
      const imageInfo = { ...result.info, fileName: snapshot.imageInfo?.fileName || result.info.fileName, status: 'ready' as const };
      updateDraft((current) => ({ ...current, imageInfo, processingOperations: operations }));
      if (result.variants) {
        await Promise.all([
          putDraftBlob(snapshot.id, 'working', await encodePixelBuffer(result.edited, 'image/png').then(({ blob }) => blob)),
          putDraftBlob(snapshot.id, 'normalized', result.variants.normalizedPng.blob),
          putDraftBlob(snapshot.id, 'optimized', result.variants.lightweightWebp.blob),
          putDraftBlob(snapshot.id, 'icon', result.variants.iconPng.blob),
          putDraftBlob(snapshot.id, 'thumbnail', result.variants.thumbnail.blob),
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
      setDraft(saved);
      draftRef.current = saved;
      setProcessed(null);
      setSprite(null);
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

  const generateMotion = useCallback(async () => {
    const current = draftRef.current;
    if (!current) return;
    const normalized = processed?.variants?.normalizedPng.blob ?? await getDraftBlob(current.id, 'normalized');
    if (!normalized) {
      setError('先に画像を切り抜いて正規化してください。');
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    const wakeLock = await acquireWakeLock();
    try {
      const result = await generateIdleMotionFromBlob(
        {
          blob: normalized,
          fileName: `${current.character.slug || 'character'}.png`,
          sourceImage: `${current.character.slug || 'character'}.png`,
          preset: current.motionPreset,
          parameters: current.motion,
          removeBackground: false,
        },
        {
          signal: controller.signal,
          onImageProgress: (item: ImageProgress) => setBusyProgress(item.progress * 0.3, item.message),
          onMotionProgress: (item: MotionProgress) => setBusyProgress(0.3 + item.progress * 0.7, item.message),
        },
      );
      setSprite(result);
      await Promise.all([
        putDraftBlob(current.id, 'sprite', result.spriteSheetPng.blob),
        setAppMeta(`${current.id}:sprite-metadata`, result.metadata),
      ]);
      persistDraftState((active) => active.id === current.id
        ? { ...active, preview: { ...active.preview, playing: true } }
        : active);
      setNotice('待機モーションとスプライトシートを生成しました。');
    } catch (cause) {
      setError(humanError(cause, '待機モーションを生成できませんでした。'));
    } finally {
      await wakeLock?.release().catch(() => undefined);
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
      setProgress(null);
    }
  }, [persistDraftState, processed, setBusyProgress]);

  const validateAndBuild = useCallback(async (): Promise<ValidationIssue[]> => {
    const current = draftRef.current;
    if (!current) return [];
    let activeSprite = sprite;
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
      ...validationExtras(current, processed, activeSprite),
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
    if (!normalizedPng || !optimizedWebp || !iconPng || !thumbnailWebp || !activeSprite) {
      const missing: ValidationIssue = { severity: 'error', code: 'artifact.missing', message: '画像生成物が不足しています。切り抜きとモーションを再生成してください。' };
      const next = [...issues, missing];
      persistDraftState((item) => ({ ...item, validation: next }));
      return next;
    }
    try {
      const nextBundle = await buildArtifactBundle({
        character: current.character,
        spriteMetadata: activeSprite.metadata,
        images: {
          normalizedPng,
          optimizedWebp,
          iconPng,
          thumbnailWebp,
          spriteSheetPng: activeSprite.spriteSheetPng.blob,
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
  }, [persistDraftState, processed, publishedCharacters, repositoryStatus.baseSha, sprite]);

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
    setBusy(true);
    setError(null);
    try {
      const result = await gatewayRef.current.createPullRequest(prepared, bundle, current.mockScenario);
      setPullRequest(result);
      await addPublishHistory({
        id: crypto.randomUUID(),
        draftId: current.id,
        characterId: current.character.id,
        displayName: current.character.displayName,
        completedAt: new Date().toISOString(),
        result,
      });
      persistDraftState((item) => ({ ...item, lastStep: 'complete', historyStatus: 'clean' }));
      setNotice('モックPRを作成し、CIと公開状態を確認しました。');
      await refreshLists();
    } catch (cause) {
      setError(humanError(cause, 'PRを作成できませんでした。'));
    } finally {
      setBusy(false);
    }
  }, [bundle, persistDraftState, prepared, refreshLists]);

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
    appVersion, view, step, stepIndex, draft, drafts, publishedCharacters, publishedWarning, history, outbox, processed, sprite, bundle, prepared, pullRequest,
    repositoryStatus, capabilities, storage, saveState, savedAt, busy, progress, error, notice, redoCount: redo.length,
    installAvailable: Boolean(installEvent), installApp, dismissNotice: () => setNotice(null), dismissError: () => setError(null),
    createNewDraft, editPublishedCharacter, openDraft, backToDashboard, duplicateExistingDraft, deleteExistingDraft, importDraft, exportDraft, updateDraft,
    goToStep, nextStep, previousStep, acceptFile, onFileInput, onDrop, applyImageOperations, autoRemoveBackground, autoTrim,
    addBrushStroke, undoImageOperation, redoImageOperation, generateMotion, validateAndBuild, downloadZip, downloadJson,
    prepareChange, createPullRequest, retryOutbox, refreshRepositoryStatus, login, logout,
    cancelProcessing: () => abortRef.current?.abort(),
  }), [
    acceptFile, addBrushStroke, appVersion, applyImageOperations, autoRemoveBackground, autoTrim, backToDashboard, bundle, busy,
    capabilities, createNewDraft, createPullRequest, deleteExistingDraft, downloadJson, downloadZip, draft, drafts, editPublishedCharacter,
    duplicateExistingDraft, error, exportDraft, generateMotion, goToStep, history, importDraft, installApp, installEvent,
    nextStep, notice, onDrop, onFileInput, openDraft, outbox, prepareChange, prepared, previousStep, processed, progress,
    pullRequest, redo.length, redoImageOperation, refreshRepositoryStatus, repositoryStatus, retryOutbox, saveState, savedAt,
    publishedCharacters, publishedWarning, sprite, step, stepIndex, storage, undoImageOperation, updateDraft, validateAndBuild, view, login, logout,
  ]);

  return value;
}

export const REGISTERED_LEGACY_CHARACTER_COUNT = LEGACY_CHARACTERS.length;
