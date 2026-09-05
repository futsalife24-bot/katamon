import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  ArtifactFile,
  CharacterForm,
  ImageEditorState,
  MotionClipId,
  MotionAction,
  MotionActionPreset,
  MotionParameters,
  PreviewSettings,
  SkillParameters,
  SpecialTemplate,
} from './domain/types';
import { WORKFLOW_STEPS } from './domain/types';
import { PUBLISH_LIMITS } from './domain/publish-limits';
import { LEGACY_CHARACTERS } from './domain/legacy-characters';
import { ACTION_LABELS, getActionPreset, listActionPresets, MOTION_CLIP_IDS, MOTION_CLIP_LABELS, MOTION_INTENSITY_LABELS } from './motion';
import type { PixelBuffer } from './image';
import { ImageCanvas } from './components/ImageCanvas';
import { MotionPreview } from './components/MotionPreview';
import { PartPreview } from './components/PartPreview';
import { useStudioController, type StudioController } from './app/use-studio-controller';
import { exportCharacterDatabaseJson, importAiProposalJson, listAiProposals, listCharacterRecords, seedCharacterDatabase } from './storage/db';
import { searchCharacterRecords, type CharacterIdentityRecord } from './domain/character-db';
import { applyAiProposalToCharacter, type AiProposal } from './domain/ai-proposal';

const SPECIAL_OPTIONS: Array<{ id: SpecialTemplate; label: string; help: string }> = [
  { id: 'single', label: '単発', help: '既存の通常弾に近い単発技です。' },
  { id: 'multi-shot', label: '複数弾・連射', help: '弾数と発射間隔を指定します。' },
  { id: 'straight', label: '直線', help: '重力の影響を受けない直線弾です。' },
  { id: 'area', label: '範囲', help: '着弾地点へ範囲効果を出します。' },
  { id: 'explosion', label: '爆発', help: '爆発半径を持つ弾です。' },
  { id: 'piercing', label: '貫通', help: '指定数の対象を貫通します。' },
  { id: 'knockback', label: 'ノックバック', help: '対象を押し出します。' },
  { id: 'healing', label: '回復', help: '発動者を回復します。' },
  { id: 'emp', label: '状態異常', help: '確率で移動を妨げます。' },
  { id: 'custom-required', label: '既存特殊技・要実装', help: '自動登録せず、仕様メモだけをPRへ含めます。' },
];

function formatBytes(bytes = 0): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function Field({ label, hint, children, required }: { label: string; hint?: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="field">
      <span className="field__label">{label}{required && <span className="required">必須</span>}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className="toggle-row">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function RangeField({ label, value, min, max, step = 1, suffix = '', onChange }: {
  label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void;
}) {
  return (
    <label className="range-field">
      <span><b>{label}</b><output>{value}{suffix}</output></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

type LandmarkTool = 'ground' | 'muzzle';

function LandmarkEditor({ studio }: { studio: StudioController }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<LandmarkTool>('ground');
  const pixels = studio.processed?.normalized.pixels ?? null;
  const landmarks = studio.draft!.landmarks;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pixels) return;
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
    const marker = (x: number, y: number, color: string, label: string) => {
      context.save();
      context.strokeStyle = color;
      context.fillStyle = color;
      context.lineWidth = Math.max(3, pixels.width / 130);
      context.beginPath();
      context.arc(x * pixels.width, y * pixels.height, Math.max(10, pixels.width / 40), 0, Math.PI * 2);
      context.stroke();
      context.font = `800 ${Math.max(15, pixels.width / 24)}px system-ui`;
      context.textAlign = 'center';
      context.fillText(label, x * pixels.width, y * pixels.height - Math.max(16, pixels.width / 32));
      context.restore();
    };
    marker(landmarks.ground.x, landmarks.ground.y, '#ff315e', '接地');
    marker(landmarks.muzzle.x, landmarks.muzzle.y, '#00c99a', '砲口');
  }, [landmarks, pixels]);

  const updateLandmarks = (updater: (current: typeof landmarks) => typeof landmarks) => studio.updateDraft((current) => ({
    ...current,
    landmarks: updater(current.landmarks),
    generatedClips: [],
  }));

  const place = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !pixels) return;
    const rect = canvas.getBoundingClientRect();
    const point = {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
    updateLandmarks((current) => {
      if (tool === 'ground') return { ...current, status: 'ready', ground: point };
      return { ...current, status: 'ready', muzzle: point };
    });
  };

  const chooseFacing = (facing: 'left' | 'right') => {
    studio.updateDraft((current) => ({
      ...current,
      landmarks: { ...current.landmarks, facing },
      character: { ...current.character, sourceFacesLeft: facing === 'left' },
      generatedClips: [],
    }));
    queueMicrotask(() => void studio.detectLandmarks());
  };

  return (
    <section className="step-panel" data-testid="step-setup">
      <div className="step-intro"><span>2</span><div><h2>向きと位置を確認</h2><p>端末内で推測します。ズレた印だけ選んで画像をタップしてください。</p></div></div>
      <p className="support-note">生成AI・外部通信は使いません。緑＝砲口、赤＝接地点です。</p>
      <h3 className="subheading">元画像が向いている方向</h3>
      <div className="segmented" role="group" aria-label="元画像の向き">
        <button type="button" className={landmarks.facing === 'left' ? 'active' : ''} onClick={() => chooseFacing('left')} data-testid="facing-left">← 左向き</button>
        <button type="button" className={landmarks.facing === 'right' ? 'active' : ''} onClick={() => chooseFacing('right')} data-testid="facing-right">右向き →</button>
      </div>
      <div className="landmark-canvas-shell">
        {pixels ? <canvas ref={canvasRef} onClick={place} data-testid="landmark-canvas" aria-label="位置を手動調整" /> : <div className="canvas-empty">先に画像を登録してください</div>}
      </div>
      <div className="landmark-tools" role="group" aria-label="修正する位置">
        {([
          ['ground', '接地点'], ['muzzle', '砲口'],
        ] as const).map(([id, label]) => <button type="button" key={id} className={tool === id ? 'active' : ''} onClick={() => setTool(id)}>{label}</button>)}
      </div>
      <button className="secondary full-width" type="button" disabled={!pixels || studio.busy} onClick={() => void studio.detectLandmarks()} data-testid="detect-landmarks">位置を自動推測し直す</button>
    </section>
  );
}

function Status({ value, good }: { value: string; good?: boolean }) {
  return <span className={`status-pill ${good ? 'status-pill--good' : ''}`}>{value}</span>;
}

function CharacterDatabaseCard() {
  const [records, setRecords] = useState<CharacterIdentityRecord[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void (async () => {
      try {
        await seedCharacterDatabase();
        setRecords(await listCharacterRecords());
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  const visible = searchCharacterRecords(records, query);
  const download = async () => {
    const blob = await exportCharacterDatabaseJson();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'content-studio-character-db.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="card" data-testid="character-database-card">
      <div className="section-heading"><div><h2>キャラクター台帳</h2><p>既存キャラの不変ID・slug・タグ・素材版・変更履歴を端末内で管理します。</p></div><Status value={loading ? '準備中' : `${records.length}体`} good={!loading && records.length > 0} /></div>
      <div className="section-heading">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前・ID・slug・タグで検索" aria-label="キャラクター台帳を検索" />
        <button className="text-button" type="button" onClick={() => void download()} disabled={loading}>DBを書き出す</button>
      </div>
      {!loading && <div className="draft-list">{visible.map((record) => <article className="draft-card" key={record.characterId}><div className="draft-card__open"><b>{record.displayName}</b><span>{record.slug}・素材v1・履歴v{record.currentRevision}</span></div><span className="support-note">{record.controlledTags.concat(record.freeTags).join(' / ')}</span></article>)}</div>}
      {!loading && visible.length === 0 && <div className="empty-state"><b>該当キャラなし</b><span>名前・旧ID・slug・タグを確認してください。</span></div>}
    </section>
  );
}

function AiProposalCard({ studio }: { studio: StudioController }) {
  const importRef = useRef<HTMLInputElement>(null);
  const [proposals, setProposals] = useState<AiProposal[]>([]);
  const [message, setMessage] = useState('');
  useEffect(() => { void listAiProposals().then(setProposals); }, []);
  const importProposal = async (file: Blob) => {
    try {
      const result = await importAiProposalJson(file);
      if (!result.proposal) throw new Error(result.errors.join(' / '));
      setProposals(await listAiProposals());
      setMessage(result.stale ? '取込済み。ただし対象キャラの履歴が古いため、公開前に最新コンテキストで再確認してください。' : '取込成功。現在は実験提案として保存されています。');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'AI提案を取り込めませんでした。');
    }
  };
  const makeDraft = async (proposal: AiProposal) => {
    const target = (await listCharacterRecords()).find((record) => record.slug === proposal.characterSlug);
    if (!target) {
      setMessage('対象キャラが台帳に見つかりません。最新のキャラクターDBを確認してください。');
      return;
    }
    await studio.createNewDraft();
    studio.updateDraft((draft) => {
      const identity = target.legacyId ?? target.slug;
      const character = applyAiProposalToCharacter({
        ...draft.character,
        id: identity,
        slug: target.slug,
        displayName: target.displayName,
      }, proposal);
      return {
        ...draft,
        title: `${target.displayName}・AI提案レビュー`,
        character,
        sourceIdentity: { id: identity, slug: target.slug },
        lastStep: 'character',
        historyStatus: 'dirty',
      };
    });
    setMessage('提案を新しい下書きへ反映しました。画像・差分・検証を確認してから公開へ進んでください。');
  };
  return (
    <section className="card" data-testid="ai-proposal-card">
      <div className="section-heading"><div><h2>AI提案JSON</h2><p>AIの提案を取り込み、検証してからプレビューへ進めます。自動公開はしません。</p></div><Status value={`${proposals.length}件`} good={proposals.length > 0} /></div>
      <input ref={importRef} hidden type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importProposal(file); }} />
      <button className="secondary full-width" type="button" onClick={() => importRef.current?.click()}>AI提案JSONを読み込む</button>
      {message && <p className="support-note" role="status">{message}</p>}
      {proposals.slice(0, 3).map((proposal) => <article className="draft-card" key={proposal.proposalId}><div className="draft-card__open"><b>{proposal.specialName}</b><span>{proposal.characterSlug}・{proposal.specialTemplate}・{proposal.status}</span></div><span className="support-note">{proposal.motionDirection || 'モーション指定なし'}</span><button className="text-button" type="button" onClick={() => void makeDraft(proposal)} data-testid={`apply-ai-proposal-${proposal.proposalId}`}>レビュー用下書きを作る</button></article>)}
    </section>
  );
}

function Dashboard({ studio }: { studio: StudioController }) {
  const importRef = useRef<HTMLInputElement>(null);
  const [legacyId, setLegacyId] = useState(LEGACY_CHARACTERS[0].id);
  const generatedCount = studio.drafts.filter((draft) => draft.generatedClips.length === 5).length;
  const migratedLegacyCount = new Set(studio.publishedCharacters.map((record) => record.legacyTargetId).filter(Boolean)).size;
  return (
    <main className="dashboard" data-testid="dashboard">
      <header className="hero">
        <div>
          <p className="eyebrow">対象ゲーム モーション制作</p>
          <h1>Content Studio</h1>
          <p>Androidだけで、画像1枚から5動作を生成しGitHubへ反映。</p>
        </div>
        <span className="version">v{studio.appVersion}</span>
      </header>

      <section className="summary-grid" aria-label="運用状況">
        <article><strong>{studio.drafts.length}</strong><span>下書き</span></article>
        <article><strong>{generatedCount}</strong><span>5動作生成済み</span></article>
        <article><strong>512</strong><span>標準画質 px</span></article>
        <article><strong>{studio.capabilities.online ? '端末内' : 'オフライン'}</strong><span>処理方式</span></article>
      </section>

      <button className="primary hero-action" type="button" onClick={() => void studio.createNewDraft()} data-testid="add-character">
        <span aria-hidden="true">＋</span> キャラクターを追加
      </button>

      <section className="card legacy-motion-card" data-testid="legacy-motion-card">
        <div className="section-heading"><div><h2>既存キャラへモーション追加</h2><p>能力・技・元の静止画像は変更せず、1体ずつ5動作だけをPRで追加します。</p></div><Status value={studio.publishedWarning ? `確認中 / ${LEGACY_CHARACTERS.length}` : `${migratedLegacyCount} / ${LEGACY_CHARACTERS.length}`} good={!studio.publishedWarning && migratedLegacyCount > 0} /></div>
        <Field label="対象キャラクター">
          <select value={legacyId} onChange={(event) => setLegacyId(event.target.value as typeof legacyId)} data-testid="legacy-character-select">
            {LEGACY_CHARACTERS.map((character) => <option key={character.id} value={character.id}>{character.displayName}</option>)}
          </select>
        </Field>
        <button className="secondary full-width" type="button" onClick={() => void studio.editLegacyCharacter(legacyId)} data-testid="edit-legacy-character">このキャラのモーションを作る</button>
        <p className="support-note">未対応キャラは従来の静止表示を継続します。一括上書きは行いません。</p>
      </section>

      {studio.publishedWarning && <section className="warning-card" role="alert" data-testid="published-warning"><p>{studio.publishedWarning}</p><p>件数は未確定です。公開時はGitHubの正規データを照合します。</p><button type="button" className="secondary" onClick={() => void studio.refreshPublishedContent()}>公開一覧を再試行</button></section>}
      {studio.outbox.length > 0 && <section className="card" data-testid="publish-recovery"><h2>公開操作の復旧</h2><p>再読込・通信切断・再ログイン後も、保存した生成物から確認できます。</p>{studio.outbox.map(item => <article className="recovery-item" key={item.id}><b>{item.bundle.character.displayName}</b><p>{item.result?.merged ? 'マージ済み・配備状況を確認' : item.result ? 'PR作成済み・CIと復旧状況を確認' : '公開準備・送信結果を確認'}</p>{item.result && <p><a href={item.result.url} target="_blank" rel="noreferrer">保存済みPR #{item.result.number}を開く</a></p>}{item.lastError && <p>{item.lastError}</p>}<button className="secondary full-width" type="button" disabled={studio.busy} onClick={() => void studio.retryOutbox(item.id)}>既存PRを確認・再開</button></article>)}</section>}
      <CharacterDatabaseCard />
      <AiProposalCard studio={studio} />

      <section className="card connection-card motion-only-note">
        <div><h2>生成AI・外部送信なし</h2><p>通常の画像処理と固定プリセットだけで動きます。画像を外部サービスへ送りません。</p></div>
        {studio.installAvailable && <button type="button" className="secondary full-width" onClick={() => void studio.installApp()}>Androidへアプリとしてインストール</button>}
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div><h2>作業中の下書き</h2><p>入力と画像はこの端末のIndexedDBへ自動保存されます。</p></div>
          <button className="text-button" type="button" onClick={() => importRef.current?.click()}>JSON読込</button>
          <input ref={importRef} hidden type="file" accept="application/json,.json" onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void studio.importDraft(file);
          }} />
        </div>
        {studio.drafts.length === 0 ? (
          <div className="empty-state"><b>下書きはまだありません</b><span>画像を1枚選ぶところから始められます。</span></div>
        ) : (
          <div className="draft-list">
            {studio.drafts.map((draft) => (
              <article className="draft-card" key={draft.id}>
                <button className="draft-card__open" type="button" onClick={() => void studio.openDraft(draft.id)}>
                  <b>{draft.character.displayName || draft.title}</b>
                  <span>{WORKFLOW_STEPS.find(({ id }) => id === draft.lastStep)?.label}・{formatDate(draft.updatedAt)}</span>
                </button>
                <div className="draft-card__actions">
                  <button type="button" onClick={() => void studio.duplicateExistingDraft(draft.id)}>複製</button>
                  <button type="button" onClick={() => void studio.exportDraft(draft.id)}>出力</button>
                  <button type="button" className="danger-text" onClick={() => {
                    if (window.confirm('この下書きを端末から削除しますか？この操作は元に戻せません。')) void studio.deleteExistingDraft(draft.id);
                  }}>削除</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="device-card">
        <b>端末ストレージ</b>
        <span>{studio.storage ? `${formatBytes(studio.storage.usage)} / ${formatBytes(studio.storage.quota)}` : 'この環境では取得できません'}</span>
        {studio.storage && <progress max={1} value={studio.storage.ratio} />}
        {studio.storage && studio.storage.ratio > 0.8 && <p className="warning-text">空き容量が少なくなっています。不要な下書きをJSON出力後に削除してください。</p>}
      </section>
    </main>
  );
}

function ImageStep({ studio }: { studio: StudioController }) {
  const info = studio.draft?.imageInfo;
  const hitInfo = studio.draft?.hitImageInfo;
  const analysis = studio.processed?.analysis;
  return (
    <section className="step-panel" data-testid="step-image">
      <div className="step-intro"><span>1</span><div><h2>画像を取り込む</h2><p>ギャラリー、ファイル、カメラ、Android共有メニューに対応します。</p></div></div>
      <label className="upload-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => void studio.onDrop(event)}>
        <input data-testid="image-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void studio.onFileInput(event)} />
        <span className="upload-zone__icon" aria-hidden="true">▣</span>
        <b>画像を選ぶ</b>
        <small>PNG・JPEG・WebP、最大20MB</small>
      </label>
      <label className="secondary full-width camera-button">
        <input hidden type="file" accept="image/*" capture="environment" onChange={(event) => void studio.onFileInput(event)} />
        カメラで撮影
      </label>
      {!studio.capabilities.shareFiles && <p className="support-note">共有APIが利用できない環境です。上の「画像を選ぶ」で同じ作業を続けられます。</p>}
      <ImageCanvas pixels={studio.processed?.original ?? null} label="取り込んだ元画像" />
      {info && (
        <dl className="facts">
          <div><dt>ファイル名</dt><dd>{info.fileName}</dd></div>
          <div><dt>元サイズ</dt><dd>{info.width} × {info.height}px</dd></div>
          <div><dt>容量</dt><dd>{formatBytes(info.byteLength)}</dd></div>
          <div><dt>透過</dt><dd>{info.hasAlpha ? 'あり' : 'なし'}</dd></div>
          <div><dt>カラーモード</dt><dd>{info.colorMode}</dd></div>
          <div><dt>読み込み</dt><dd>{info.status}</dd></div>
          <div><dt>処理後の推定</dt><dd>{formatBytes(info.estimatedOutputBytes)}</dd></div>
          <div><dt>安全縮小</dt><dd>{studio.processed?.decodeScale && studio.processed.decodeScale < 1 ? `${Math.round(studio.processed.decodeScale * 100)}%` : '不要'}</dd></div>
        </dl>
      )}
      {analysis && (
        <div className="analysis-box">
          <b>自動判定</b>
          <ul>
            <li>透明画素: {(analysis.alphaPixelRatio * 100).toFixed(1)}%</li>
            <li>単色背景らしさ: {(analysis.solidBackgroundConfidence * 100).toFixed(0)}%</li>
            <li>{analysis.hasBakedCheckerboard ? '市松模様の焼き込み候補あり' : '市松模様の焼き込み候補なし'}</li>
            <li>{analysis.hasBakedBlackBackground ? '黒背景の焼き込み候補あり' : '黒背景の焼き込み候補なし'}</li>
          </ul>
          {analysis.warnings.map((warning) => <p className="warning-text" key={warning}>{warning}</p>)}
        </div>
      )}
      <article className={`hit-image-card ${hitInfo ? 'has-image' : ''}`} data-testid="hit-image-card">
        <div className="section-heading">
          <div><h3>被弾時の画像</h3><p>任意。別で作った表情差分があれば、被弾だけこちらへ切り替えます。</p></div>
          <Status value={hitInfo ? '設定済み' : '通常画像を使用'} good={Boolean(hitInfo)} />
        </div>
        <label className="secondary full-width hit-image-picker">
          <input data-testid="hit-image-input" hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void studio.onHitFileInput(event)} />
          {hitInfo ? '被弾用画像を選び直す' : '被弾用画像を選ぶ'}
        </label>
        {hitInfo && <>
          <ImageCanvas pixels={studio.hitProcessed?.normalized.pixels ?? null} label="被弾時に使う画像" />
          <dl className="facts facts--compact">
            <div><dt>ファイル名</dt><dd>{hitInfo.fileName}</dd></div>
            <div><dt>サイズ</dt><dd>{hitInfo.width} × {hitInfo.height}px</dd></div>
            <div><dt>容量</dt><dd>{formatBytes(hitInfo.byteLength)}</dd></div>
            <div><dt>透過</dt><dd>{hitInfo.hasAlpha ? 'あり' : 'なし'}</dd></div>
          </dl>
          <button type="button" className="text-button full-width" disabled={studio.busy} onClick={() => void studio.removeHitImage()}>被弾用画像を外す</button>
        </>}
        <p className="support-note">未選択なら通常画像をそのまま使います。画像そのものへ×目を描く処理は行いません。</p>
      </article>
    </section>
  );
}

function CutoutStep({ studio, embedded = false }: { studio: StudioController; embedded?: boolean }) {
  const [compare, setCompare] = useState<'before' | 'after'>('after');
  const draft = studio.draft!;
  const editor = draft.editor;
  const changeEditor = <K extends keyof ImageEditorState>(key: K, value: ImageEditorState[K]) => studio.updateDraft((current) => ({ ...current, editor: { ...current.editor, [key]: value } }));
  const pixels = compare === 'before' ? studio.processed?.original : studio.processed?.edited;
  return (
    <section className={`step-panel ${embedded ? 'embedded-cutout' : ''}`} data-testid="step-cutout">
      {!embedded && <div className="step-intro"><span>1</span><div><h2>背景除去と切り抜き</h2><p>端末内だけで処理します。画像を外部へ送信しません。</p></div></div>}
      {embedded && <div className="section-heading"><div><h2>切り抜きを確認</h2><p>必要なときだけ背景除去や補正を使います。</p></div></div>}
      <div className="segmented" role="group" aria-label="処理前後の比較">
        <button type="button" className={compare === 'before' ? 'active' : ''} onClick={() => setCompare('before')}>処理前</button>
        <button type="button" className={compare === 'after' ? 'active' : ''} onClick={() => setCompare('after')}>処理後</button>
      </div>
      <p className="support-note">ここは切り抜きを確認する静止画です。動きは次の「モーション」で生成します。</p>
      <div className="tool-selector" role="group" aria-label="補正ブラシ">
        {(['pan', 'erase', 'restore'] as const).map((tool) => <button type="button" key={tool} className={editor.tool === tool ? 'active' : ''} onClick={() => changeEditor('tool', tool)}>{tool === 'pan' ? '確認' : tool === 'erase' ? '消しゴム' : '復元ブラシ'}</button>)}
      </div>
      <p className="field-help">画像の上からページを動かすときは「確認」を選んで上下にスワイプしてください。</p>
      <ImageCanvas
        pixels={pixels ?? null}
        label={compare === 'before' ? '背景除去前' : '背景除去後'}
        zoom={editor.zoom}
        tool={compare === 'after' ? editor.tool : 'pan'}
        brushSize={editor.brushSize}
        disabled={studio.busy}
        onStroke={(points) => void studio.addBrushStroke({ type: 'brush', mode: editor.tool === 'restore' ? 'restore' : 'erase', size: editor.brushSize, points })}
      />
      <div className="button-grid">
        <button type="button" className="primary" disabled={!draft.imageInfo || studio.busy} onClick={() => void studio.autoRemoveBackground()}>自動背景除去</button>
        <button type="button" className="secondary" disabled={!draft.imageInfo || studio.busy} onClick={() => void studio.autoTrim()}>余白を自動トリム</button>
        <button type="button" className="secondary" disabled={draft.processingOperations.length === 0 || studio.busy} onClick={() => void studio.undoImageOperation()}>元に戻す</button>
        <button type="button" className="secondary" disabled={studio.redoCount === 0 || studio.busy} onClick={() => void studio.redoImageOperation()}>やり直す</button>
      </div>
      <RangeField label="ブラシサイズ" value={editor.brushSize} min={4} max={160} suffix="px" onChange={(value) => changeEditor('brushSize', value)} />
      <RangeField label="拡大表示" value={editor.zoom} min={1} max={3} step={0.1} suffix="倍" onChange={(value) => changeEditor('zoom', value)} />
      <details className="controls-card">
        <summary>背景と配置の調整</summary>
        <RangeField label="背景許容値" value={editor.tolerance} min={4} max={100} onChange={(value) => changeEditor('tolerance', value)} />
        <RangeField label="輪郭補正" value={editor.edgeFeather} min={0} max={6} step={0.5} suffix="px" onChange={(value) => changeEditor('edgeFeather', value)} />
        <RangeField label="左右位置" value={editor.offsetX} min={-128} max={128} suffix="px" onChange={(value) => changeEditor('offsetX', value)} />
        <RangeField label="上下位置" value={editor.offsetY} min={-128} max={128} suffix="px" onChange={(value) => changeEditor('offsetY', value)} />
        <RangeField label="大きさ" value={editor.scale} min={0.25} max={1.5} step={0.01} suffix="倍" onChange={(value) => changeEditor('scale', value)} />
        <RangeField label="余白" value={editor.padding} min={0} max={128} suffix="px" onChange={(value) => changeEditor('padding', value)} />
        <Field label="出力サイズ"><select value={editor.outputSize} onChange={(event) => changeEditor('outputSize', Number(event.target.value) as ImageEditorState['outputSize'])}><option value="128">128px</option><option value="256">256px</option><option value="384">384px</option><option value="512">512px</option></select></Field>
        <Toggle label="左右反転" checked={editor.flipHorizontal} onChange={(checked) => changeEditor('flipHorizontal', checked)} />
        <button type="button" className="primary full-width" disabled={studio.busy} onClick={() => void studio.applyImageOperations()}>変更を画像へ反映</button>
      </details>
      <p className="support-note">底面中央を基準に正方形へ配置します。小さなハンドル操作やピンチ操作は不要です。</p>
    </section>
  );
}

function PartsStep({ studio }: { studio: StudioController }) {
  const draft = studio.draft!;
  const detection = draft.partDetection;
  const updateDetection = (changes: Partial<typeof detection>) => studio.updateDraft((current) => ({
    ...current,
    partDetection: { ...current.partDetection, ...changes },
  }));
  const setEnabled = (id: string, enabled: boolean) => {
    const parts = detection.parts.map((part) => part.id === id ? { ...part, enabled } : part);
    const firstEnabled = parts.find((part) => part.enabled)?.id ?? null;
    updateDetection({
      parts,
      focusPartId: parts.some((part) => part.enabled && part.id === detection.focusPartId) ? detection.focusPartId : firstEnabled,
      anchorPartId: parts.some((part) => part.enabled && part.id === detection.anchorPartId) ? detection.anchorPartId : firstEnabled,
    });
  };
  return (
    <section className="step-panel" data-testid="step-parts">
      <div className="step-intro"><span>3</span><div><h2>部位候補を確認</h2><p>透明な輪郭を端末内で分割し、動作の中心と接地点を決めます。</p></div></div>
      <p className="support-note">生成AIや外部通信は使いません。解剖学的な判定ではなく「上・中心・左右・接地」の候補なので、画像に合わせて選び直せます。</p>
      <PartPreview
        source={studio.processed?.normalized.pixels ?? null}
        parts={detection.parts}
        focusPartId={detection.focusPartId}
        anchorPartId={detection.anchorPartId}
      />
      <button className="primary full-width" type="button" disabled={studio.busy || !studio.processed} onClick={() => void studio.detectParts()} data-testid="detect-parts">
        {detection.parts.length ? '部位候補を再検出' : '部位候補を検出'}
      </button>
      {detection.parts.length > 0 && <>
        <div className="part-candidate-list">
          {detection.parts.map((part) => (
            <label className={`part-candidate ${part.enabled ? 'is-enabled' : ''}`} key={part.id}>
              <input type="checkbox" checked={part.enabled} onChange={(event) => setEnabled(part.id, event.target.checked)} />
              <span><b>{part.label}</b><small>候補度 {Math.round(part.confidence * 100)}%・画像の{Math.round(part.pixelRatio * 100)}%</small></span>
            </label>
          ))}
        </div>
        <Field label="砲撃・被弾の動作中心" hint="武器や前面に近い候補を選びます">
          <select data-testid="focus-part" value={detection.focusPartId ?? ''} onChange={(event) => updateDetection({ focusPartId: event.target.value || null })}>
            {detection.parts.filter(({ enabled }) => enabled).map((part) => <option key={part.id} value={part.id}>{part.label}</option>)}
          </select>
        </Field>
        <Field label="待機・移動の接地点" hint="車輪、足元、影に近い候補を選びます">
          <select data-testid="anchor-part" value={detection.anchorPartId ?? ''} onChange={(event) => updateDetection({ anchorPartId: event.target.value || null })}>
            {detection.parts.filter(({ enabled }) => enabled).map((part) => <option key={part.id} value={part.id}>{part.label}</option>)}
          </select>
        </Field>
      </>}
    </section>
  );
}

function MotionStep({ studio }: { studio: StudioController }) {
  const draft = studio.draft!;
  const generatedCount = MOTION_CLIP_IDS.filter((clipId) => studio.motions[clipId]).length;
  const active = studio.motions[studio.selectedClip] ?? null;
  return (
    <section className="step-panel motion-batch-step" data-testid="step-motion">
      <div className="step-intro"><span>3</span><div><h2>5種類をまとめて生成</h2><p>各動作を「控えめ・標準・激しめ」の3段階だけで調整できます。</p></div></div>
      <p className="support-note">公開上限は各ファイル{((studio.repositoryStatus.publishLimits ?? PUBLISH_LIMITS).maxFileBytes / 1024 ** 2) + ' MiB'}、全ファイル合計{((studio.repositoryStatus.publishLimits ?? PUBLISH_LIMITS).maxTotalFileBytes / 1024 ** 2) + ' MiB'}です。超過時も生成結果は保存します。出力サイズを調整し、再生成できます。</p>
      <div className="motion-batch-list" aria-label="生成するモーション">
        {MOTION_CLIP_IDS.map((clipId, index) => <article key={clipId} className={studio.motions[clipId] ? 'is-complete' : ''}>
          <div className="motion-card-heading"><span>{index + 1}</span><div><b>{MOTION_CLIP_LABELS[clipId]}</b><small>{clipId === 'move-forward' ? '向きを保ったその場前進' : clipId === 'move-backward' ? '向きを保ったまま後ずさり' : clipId === 'fire' ? '1発だけの反動' : clipId === 'hit' ? `${draft.hitImageInfo ? '専用画像で' : ''}後方へ反転着地・低くバウンド・遅れて復帰` : '落下から接地して静止'}</small></div><strong>{studio.motions[clipId] ? '✓' : '—'}</strong></div>
          <div className="motion-intensity-buttons" role="group" aria-label={`${MOTION_CLIP_LABELS[clipId]}の動きの強さ`}>
            {(['subtle', 'standard', 'strong'] as const).map((level) => <button
              type="button"
              key={level}
              className={draft.motionIntensity[clipId] === level ? 'active' : ''}
              aria-pressed={draft.motionIntensity[clipId] === level}
              disabled={studio.busy}
              onClick={() => void studio.setMotionIntensity(clipId, level)}
              data-testid={`intensity-${clipId}-${level}`}
            >{MOTION_INTENSITY_LABELS[level]}</button>)}
          </div>
        </article>)}
      </div>
      {generatedCount > 0 ? <>
        <h3 className="subheading">プレビュー</h3>
        <div className="clip-tabs" role="group" aria-label="確認するモーション">
          {MOTION_CLIP_IDS.map((clipId) => <button type="button" key={clipId} disabled={!studio.motions[clipId]} className={studio.selectedClip === clipId ? 'active' : ''} onClick={() => studio.selectMotionClip(clipId)} data-testid={`preview-${clipId}`}>{MOTION_CLIP_LABELS[clipId]}</button>)}
        </div>
        <MotionPreview sprite={active} fallback={studio.processed?.normalized.pixels ?? null} settings={draft.preview} label={`${MOTION_CLIP_LABELS[studio.selectedClip]}プレビュー`} />
        <button type="button" className="secondary full-width" onClick={() => studio.updateDraft((current) => ({ ...current, preview: { ...current.preview, playing: !current.preview.playing } }))}>
          {draft.preview.playing ? 'プレビュー停止' : active?.metadata.loop ? 'プレビュー再生' : 'もう一度再生'}
        </button>
        {active && <dl className="facts facts--compact"><div><dt>動作</dt><dd>{MOTION_CLIP_LABELS[studio.selectedClip]}</dd></div><div><dt>画質</dt><dd>{active.metadata.frameWidth}px</dd></div><div><dt>容量</dt><dd>{formatBytes(active.spriteSheetPng.byteLength)}</dd></div><div><dt>再生</dt><dd>{active.metadata.loop ? 'ループ' : '1回'}</dd></div></dl>}
      </> : <div className="empty-state"><b>まだ生成していません</b><span>下の固定ボタンは、どこまでスクロールしても押せます。</span></div>}
      <p className="support-note">顔・武器・配色を生成し直す処理はありません。元画像を固定の2D変形で動かすため、通常運用でAI APIは一切呼びません。</p>
      <div className={`motion-generate-dock ${studio.busy ? 'is-busy' : ''}`} aria-label="モーション生成">
        {studio.busy ? <>
          <div className="dock-progress"><b>{studio.progress?.label ?? '生成しています…'}</b><span>{Math.round((studio.progress?.value ?? 0) * 100)}%</span></div>
          <progress max={1} value={studio.progress?.value ?? 0} />
          <button className="secondary full-width" type="button" onClick={studio.cancelProcessing}>生成を中止</button>
        </> : <button className="primary full-width generate-motion-button" type="button" disabled={!draft.imageInfo || !studio.processed} onClick={() => void studio.generateMotion()} data-testid="generate-motion">
          {generatedCount === MOTION_CLIP_IDS.length ? '5種類を再生成' : '5種類をまとめて生成'}
        </button>}
      </div>
    </section>
  );
}

function CharacterStep({ studio }: { studio: StudioController }) {
  const character = studio.draft!.character;
  const legacyTarget = studio.draft!.legacyTargetId
    ? LEGACY_CHARACTERS.find(({ id }) => id === studio.draft!.legacyTargetId)
    : null;
  const setDisplayName = (displayName: string) => studio.updateDraft((current) => ({
    ...current,
    title: displayName.trim() || current.title,
    character: { ...current.character, displayName, specialEnabled: false, specialName: '未設定' },
  }));
  const setId = (id: string) => studio.updateDraft((current) => ({
    ...current,
    character: { ...current.character, id, slug: id, specialEnabled: false, specialName: '未設定' },
  }));
  return (
    <section className="step-panel" data-testid="step-character">
      <div className="step-intro"><span>4</span><div><h2>{legacyTarget ? '既存情報を確認' : 'キャラクター名を入力'}</h2><p>{legacyTarget ? '既存情報を変更せず、モーション参照だけを追加します。' : '技や能力は後回し。ゲームへ選択可能にする最小情報だけです。'}</p></div></div>
      <MotionPreview sprite={studio.motions['move-forward'] ?? null} fallback={studio.processed?.normalized.pixels ?? null} settings={{ ...studio.draft!.preview, showAnchor: false, showCollision: false }} label="キャラクタープレビュー" />
      {legacyTarget && <div className="read-only-card"><b>既存キャラクターへ追加中</b><span>{legacyTarget.displayName}</span><small>名前・能力・技は既存ゲーム側をそのまま保持し、5モーション参照だけを追加します。</small></div>}
      <Field label="表示名" required><input data-testid="display-name" disabled={Boolean(legacyTarget)} maxLength={40} enterKeyHint="next" value={character.displayName} onChange={(event) => setDisplayName(event.target.value)} /></Field>
      <Field label="短いID" hint="小文字英字から開始。小文字英数字とハイフン、24文字以内" required>
        <input data-testid="character-id" disabled={Boolean(studio.draft!.sourceIdentity)} autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={24} value={character.id} onChange={(event) => setId(event.target.value.toLowerCase())} />
      </Field>
      <dl className="facts facts--compact"><div><dt>slug</dt><dd>{character.slug || 'IDから自動設定'}</dd></div><div><dt>通常技</dt><dd>{legacyTarget ? '既存設定を保持' : '標準弾'}</dd></div><div><dt>必殺技</dt><dd>{legacyTarget ? '既存設定を保持' : '未設定（ボタン無効）'}</dd></div><div><dt>向き</dt><dd>{studio.draft!.landmarks.facing === 'left' ? '左向き' : '右向き'}</dd></div></dl>
      <p className="support-note">{legacyTarget ? '生成物は新しいモーション用ディレクトリへ追加し、元のキャラクターデータや画像を上書きしません。' : '登録後すぐキャラクター一覧から選べます。必殺技ボタンは「未設定」と表示して押せない状態にします。'}</p>
    </section>
  );
}

function DetailsStep({ studio }: { studio: StudioController }) {
  const character = studio.draft!.character;
  const set = <K extends keyof CharacterForm>(key: K, value: CharacterForm[K]) => studio.updateDraft((current) => ({ ...current, title: key === 'displayName' && String(value).trim() ? String(value) : current.title, character: { ...current.character, [key]: value } }));
  const stat = (key: 'attack' | 'defense' | 'speed' | 'weight', label: string) => <Field label={label}><select value={character[key]} onChange={(event) => set(key, Number(event.target.value) as CharacterForm[typeof key])}>{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}</select></Field>;
  return (
    <section className="step-panel" data-testid="step-details">
      <div className="step-intro"><span>4</span><div><h2>基本情報</h2><p>コードではなく、検証済みの正規データとして保存します。</p></div></div>
      <Field label="内部ID" hint={studio.draft!.sourceIdentity ? '更新時は変更できません' : '小文字英数字とハイフン、24文字以内'} required><input data-testid="character-id" disabled={Boolean(studio.draft!.sourceIdentity)} autoCapitalize="none" autoCorrect="off" value={character.id} onChange={(event) => set('id', event.target.value)} /></Field>
      <Field label="slug" hint={studio.draft!.sourceIdentity ? '更新時は変更できません' : '画像の保存先とファイル名に利用します'} required><input data-testid="character-slug" disabled={Boolean(studio.draft!.sourceIdentity)} autoCapitalize="none" autoCorrect="off" value={character.slug} onChange={(event) => set('slug', event.target.value)} /></Field>
      <Field label="表示名" required><input data-testid="display-name" maxLength={40} value={character.displayName} onChange={(event) => set('displayName', event.target.value)} /></Field>
      <div className="two-columns">
        <Field label="属性"><select value={character.attribute} onChange={(event) => set('attribute', event.target.value as CharacterForm['attribute'])}><option value="neutral">無</option><option value="fire">火</option><option value="water">水</option><option value="earth">地</option><option value="wind">風</option><option value="light">光</option><option value="dark">闇</option></select></Field>
        <Field label="分類"><input value={character.classification} maxLength={40} onChange={(event) => set('classification', event.target.value)} /></Field>
        <Field label="レアリティ"><select value={character.rarity} onChange={(event) => set('rarity', Number(event.target.value) as CharacterForm['rarity'])}>{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}</select></Field>
        <Field label="移動特性"><select value={character.movement} onChange={(event) => set('movement', event.target.value as CharacterForm['movement'])}><option value="ground">地上</option><option value="floating">浮遊</option><option value="flying">飛行</option><option value="flexible">柔体</option></select></Field>
      </div>
      <Field label="説明"><textarea rows={4} maxLength={500} value={character.description} onChange={(event) => set('description', event.target.value)} /></Field>
      <Field label="タグ" hint="カンマ区切り、最大20個"><input value={character.tags.join(', ')} onChange={(event) => set('tags', event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 20))} /></Field>
      <details className="controls-card" open>
        <summary>解放条件</summary>
        <p className="field-help">現在は全キャラを開放したまま運用し、条件を有効にしたキャラだけゲーム内でロックします。</p>
        <Toggle label="このキャラを条件付きで解放する" checked={character.unlock.enabled} onChange={(enabled) => set('unlock', { ...character.unlock, enabled })} />
        <div className="two-columns">
          <Field label="条件の種類"><select value={character.unlock.type} disabled={!character.unlock.enabled} onChange={(event) => set('unlock', { ...character.unlock, type: event.target.value as CharacterForm['unlock']['type'] })}>
            <option value="always">常時解放</option>
            <option value="wins">累計勝利数</option>
            <option value="streak">連勝突破数</option>
            <option value="login-days">ログイン日数</option>
            <option value="achievement">実績達成</option>
          </select></Field>
          <Field label="目標値" hint="勝利数・連勝数・ログイン日数"><input type="number" inputMode="numeric" min="0" max="999999" disabled={!character.unlock.enabled || character.unlock.type === 'always' || character.unlock.type === 'achievement'} value={character.unlock.target} onChange={(event) => set('unlock', { ...character.unlock, target: Number(event.target.value) })} /></Field>
        </div>
        <Field label="実績ID" hint="実績条件の時だけ使用。例: steel-stage-clear"><input autoCapitalize="none" disabled={!character.unlock.enabled || character.unlock.type !== 'achievement'} maxLength={64} value={character.unlock.achievementId} onChange={(event) => set('unlock', { ...character.unlock, achievementId: event.target.value })} /></Field>
        <Field label="解放条件の説明" hint="キャラ選択画面に表示する短い説明"><input maxLength={120} disabled={!character.unlock.enabled} value={character.unlock.description} onChange={(event) => set('unlock', { ...character.unlock, description: event.target.value })} placeholder="連戦を30勝突破で解放" /></Field>
      </details>
      <Field label="HP"><input type="number" inputMode="numeric" min="1" max="999" value={character.maxHp} onChange={(event) => set('maxHp', Number(event.target.value))} /></Field>
      <div className="four-columns">{stat('attack', '攻撃')}{stat('defense', '防御')}{stat('speed', '速度')}{stat('weight', '重量')}</div>
      <div className="two-columns">
        <Field label="テーマ色"><input type="color" value={character.color} onChange={(event) => set('color', event.target.value)} /></Field>
        <Field label="スプライト倍率"><input type="number" inputMode="decimal" min="0.25" max="3" step="0.05" value={character.spriteScale} onChange={(event) => set('spriteScale', Number(event.target.value))} /></Field>
      </div>
      <Toggle label="元画像が左向き" checked={character.sourceFacesLeft} onChange={(checked) => set('sourceFacesLeft', checked)} />
      <details className="controls-card">
        <summary>既存ゲーム互換パラメータ</summary>
        <div className="two-columns">
          {([
            ['blastMultiplier', '爆風倍率'], ['windMultiplier', '風倍率'], ['fuelMultiplier', '燃料倍率'], ['velocityMultiplier', '速度倍率'],
            ['damageTakenMultiplier', '被ダメ倍率'], ['guideMultiplier', '誘導倍率'], ['gravityMultiplier', '重力倍率'], ['specialVelocityMultiplier', '必殺速度倍率'], ['cpuTargetBias', 'CPU狙われ度'],
          ] as const).map(([key, label]) => <Field key={key} label={label}><input type="number" inputMode="decimal" min="0" max="3" step="0.05" value={character[key]} onChange={(event) => set(key, Number(event.target.value))} /></Field>)}
        </div>
        <Field label="実装バージョン"><input value={character.implementationVersion} onChange={(event) => set('implementationVersion', event.target.value)} /></Field>
      </details>
    </section>
  );
}

function SkillsStep({ studio }: { studio: StudioController }) {
  const character = studio.draft!.character;
  const setCharacter = <K extends keyof CharacterForm>(key: K, value: CharacterForm[K]) => studio.updateDraft((current) => ({ ...current, character: { ...current.character, [key]: value } }));
  const setParameter = <K extends keyof SkillParameters>(key: K, value: SkillParameters[K]) => setCharacter('specialParameters', { ...character.specialParameters, [key]: value });
  const selected = SPECIAL_OPTIONS.find(({ id }) => id === character.specialTemplate)!;
  return (
    <section className="step-panel" data-testid="step-skills">
      <div className="step-intro"><span>5</span><div><h2>技を設定</h2><p>固定テンプレートだけを使い、自由入力JavaScriptは実行しません。</p></div></div>
      <article className="read-only-card"><span>通常技</span><b>標準弾</b><small>既存ゲームの共通発射処理を再利用（変更不可）</small></article>
      <Field label="必殺技名" required><input data-testid="special-name" maxLength={40} value={character.specialName} onChange={(event) => setCharacter('specialName', event.target.value)} /></Field>
      <Field label="説明"><textarea rows={3} maxLength={200} value={character.specialDescription} onChange={(event) => setCharacter('specialDescription', event.target.value)} /></Field>
      <Field label="技テンプレート"><select data-testid="special-template" value={character.specialTemplate} onChange={(event) => setCharacter('specialTemplate', event.target.value as SpecialTemplate)}>{SPECIAL_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
      <p className="field-help">{selected.help}</p>
      {character.specialTemplate === 'custom-required' ? (
        <div className="warning-card">
          <b>カスタム実装が必要です</b>
          <p>このキャラクターは互換カタログへ自動登録されません。仕様メモをPR本文へ出力します。</p>
          <Field label="実装仕様メモ" required><textarea rows={6} maxLength={1000} value={character.customImplementationNote} onChange={(event) => setCharacter('customImplementationNote', event.target.value)} /></Field>
        </div>
      ) : (
        <div className="two-columns">
          <Field label="威力"><input type="number" inputMode="decimal" min="0.05" max="5" step="0.05" value={character.specialParameters.power} onChange={(event) => setParameter('power', Number(event.target.value))} /></Field>
          <Field label="クールタイム"><input type="number" inputMode="numeric" min="1" max="20" value={character.specialParameters.cooldownTurns} onChange={(event) => setParameter('cooldownTurns', Number(event.target.value))} /></Field>
          <Field label="弾数"><input type="number" inputMode="numeric" min="1" max="12" value={character.specialParameters.projectileCount} onChange={(event) => setParameter('projectileCount', Number(event.target.value))} /></Field>
          <Field label="発射間隔 (ms)"><input type="number" inputMode="numeric" min="0" max="3000" step="50" value={character.specialParameters.intervalMs} onChange={(event) => setParameter('intervalMs', Number(event.target.value))} /></Field>
          <Field label="弾速"><input type="number" inputMode="decimal" min="0.1" max="5" step="0.05" value={character.specialParameters.projectileSpeed} onChange={(event) => setParameter('projectileSpeed', Number(event.target.value))} /></Field>
          <Field label="重力影響"><input type="number" inputMode="decimal" min="0" max="3" step="0.05" value={character.specialParameters.gravityMultiplier} onChange={(event) => setParameter('gravityMultiplier', Number(event.target.value))} /></Field>
          <Field label="爆発範囲"><input type="number" inputMode="decimal" min="0.1" max="5" step="0.05" value={character.specialParameters.explosionRadius} onChange={(event) => setParameter('explosionRadius', Number(event.target.value))} /></Field>
          <Field label="貫通数"><input type="number" inputMode="numeric" min="0" max="20" value={character.specialParameters.penetrationCount} onChange={(event) => setParameter('penetrationCount', Number(event.target.value))} /></Field>
          <Field label="ノックバック"><input type="number" inputMode="decimal" min="0" max="500" value={character.specialParameters.knockback} onChange={(event) => setParameter('knockback', Number(event.target.value))} /></Field>
          <Field label="回復量"><input type="number" inputMode="numeric" min="0" max="999" value={character.specialParameters.healing} onChange={(event) => setParameter('healing', Number(event.target.value))} /></Field>
          <Field label="状態異常確率"><input type="number" inputMode="decimal" min="0" max="1" step="0.05" value={character.specialParameters.statusChance} onChange={(event) => setParameter('statusChance', Number(event.target.value))} /></Field>
          <Field label="状態異常ターン"><input type="number" inputMode="numeric" min="0" max="20" value={character.specialParameters.statusDurationTurns} onChange={(event) => setParameter('statusDurationTurns', Number(event.target.value))} /></Field>
          <Field label="エフェクト参照"><input autoCapitalize="none" value={character.specialParameters.effectRef} onChange={(event) => setParameter('effectRef', event.target.value)} /></Field>
          <Field label="効果音参照"><input autoCapitalize="none" value={character.specialParameters.soundRef} onChange={(event) => setParameter('soundRef', event.target.value)} /></Field>
        </div>
      )}
    </section>
  );
}

function PreviewStep({ studio }: { studio: StudioController }) {
  const draft = studio.draft!;
  const setPreview = <K extends keyof PreviewSettings>(key: K, value: PreviewSettings[K]) => studio.updateDraft((current) => ({ ...current, preview: { ...current.preview, [key]: value } }));
  return (
    <section className="step-panel" data-testid="step-preview">
      <div className="step-intro"><span>5</span><div><h2>モーションを確認</h2><p>向き・背景・サイズを切り替え、輪郭と動きの滑らかさを確認します。</p></div></div>
      {!studio.sprite && <p className="warning-card">まだモーションがありません。前の画面で生成してください。</p>}
      <MotionPreview sprite={studio.sprite} fallback={studio.processed?.normalized.pixels ?? null} settings={draft.preview} metadata={studio.sprite?.metadata} label="モーション最終プレビュー" />
      <button type="button" className="secondary full-width" disabled={!studio.sprite} onClick={() => setPreview('playing', !draft.preview.playing)}>{draft.preview.playing ? 'プレビュー停止' : 'プレビュー再生'}</button>
      <div className="segmented segmented--three"><button type="button" className={draft.preview.background === 'light' ? 'active' : ''} onClick={() => setPreview('background', 'light')}>明るい</button><button type="button" className={draft.preview.background === 'dark' ? 'active' : ''} onClick={() => setPreview('background', 'dark')}>暗い</button><button type="button" className={draft.preview.background === 'game' ? 'active' : ''} onClick={() => setPreview('background', 'game')}>ゲーム風</button></div>
      <div className="two-columns"><Field label="向き"><select value={draft.preview.direction} onChange={(event) => setPreview('direction', event.target.value as PreviewSettings['direction'])}><option value="left">左向き</option><option value="right">右向き</option></select></Field><Field label="表示サイズ"><select value={draft.preview.size} onChange={(event) => setPreview('size', event.target.value as PreviewSettings['size'])}><option value="small">小</option><option value="normal">通常</option></select></Field></div>
      <Toggle label="基準点を表示" checked={draft.preview.showAnchor} onChange={(checked) => setPreview('showAnchor', checked)} />
      <Toggle label="当たり判定候補を表示" checked={draft.preview.showCollision} onChange={(checked) => setPreview('showCollision', checked)} />
      <dl className="facts facts--compact"><div><dt>動作</dt><dd>{ACTION_LABELS[draft.motionAction].label}</dd></div><div><dt>プリセット</dt><dd>{getActionPreset(draft.actionPreset).label}</dd></div><div><dt>スプライト</dt><dd>{formatBytes(studio.sprite?.spriteSheetPng.byteLength)}</dd></div><div><dt>画質</dt><dd>{studio.sprite?.metadata.frameWidth === 512 ? '高画質' : '軽量'}</dd></div></dl>
    </section>
  );
}

function ExportStep({ studio }: { studio: StudioController }) {
  const draft = studio.draft!;
  const sprite = studio.sprite;
  return (
    <section className="step-panel" data-testid="step-export">
      <div className="step-intro"><span>6</span><div><h2>モーションを書き出す</h2><p>スプライトシート、メタデータ、部位候補をまとめて保存します。</p></div></div>
      <article className="export-summary card">
        <div className="section-heading"><div><h3>{getActionPreset(draft.actionPreset).label}</h3><p>{ACTION_LABELS[draft.motionAction].label}・{draft.motion.frameCount}フレーム</p></div><Status value={sprite ? '生成済み' : '未生成'} good={Boolean(sprite)} /></div>
        <dl className="facts facts--compact"><div><dt>フレーム</dt><dd>{sprite ? `${sprite.metadata.frameWidth} × ${sprite.metadata.frameHeight}px` : '—'}</dd></div><div><dt>容量</dt><dd>{formatBytes(sprite?.spriteSheetPng.byteLength)}</dd></div><div><dt>部位候補</dt><dd>{draft.partDetection.parts.filter(({ enabled }) => enabled).length}個</dd></div><div><dt>処理</dt><dd>{sprite?.usedWorker ? '端末Worker' : sprite ? '軽量代替' : '—'}</dd></div></dl>
      </article>
      <button type="button" className="primary full-width export-primary" disabled={!sprite || studio.busy} onClick={() => void studio.downloadMotionZip()} data-testid="download-motion-zip">モーション一式をZIP保存</button>
      <div className="button-grid">
        <button type="button" className="secondary" disabled={!sprite} onClick={() => void studio.downloadSpriteSheet()}>PNGだけ保存</button>
        <button type="button" className="secondary" disabled={!sprite} onClick={() => void studio.downloadMotionMetadata()}>JSONだけ保存</button>
      </div>
      <details className="controls-card">
        <summary>ZIPに入るファイル</summary>
        <ul className="package-file-list"><li>motion/sprite-sheet.png</li><li>motion/sprite-metadata.json</li><li>motion/motion-profile.json</li></ul>
      </details>
      <p className="support-note">技・能力・GitHub反映はこの日常フローから外しました。ここで作ったモーション素材を、後からゲーム側の設定へ紐づけます。</p>
      <button type="button" className="secondary full-width" onClick={() => void studio.backToDashboard()}>下書きを保存して終了</button>
    </section>
  );
}

function ValidateStep({ studio }: { studio: StudioController }) {
  const issues = [...(studio.draft?.validation ?? []), ...(studio.bundle?.issues ?? [])];
  return (
    <section className="step-panel" data-testid="step-validate">
      <div className="step-intro"><span>7</span><div><h2>検証</h2><p>入力、画像参照、パス、容量、既存IDとの衝突をまとめて確認します。</p></div></div>
      <ul className="check-list">
        <li className={studio.draft?.imageInfo ? 'pass' : ''}>画像を登録</li>
        <li className={studio.processed?.variants ? 'pass' : ''}>正規化画像とアイコンを生成</li>
        <li className={studio.sprite ? 'pass' : ''}>待機モーションを生成</li>
        <li className={studio.draft?.character.id && studio.draft.character.slug ? 'pass' : ''}>IDとslugを入力</li>
        <li className={studio.draft?.character.specialName ? 'pass' : ''}>技情報を入力</li>
      </ul>
      <button type="button" className="primary full-width" disabled={studio.busy} onClick={() => void studio.validateAndBuild()} data-testid="run-validation">入力と生成ファイルを検証</button>
      {issues.length === 0 ? <div className="empty-state"><b>まだ検証していません</b><span>上のボタンで安全性と整合性を確認します。</span></div> : (
        <div className="issue-list">{issues.map((issue, index) => <article key={`${issue.code}-${index}`} className={`issue issue--${issue.severity}`}><b>{issue.severity === 'error' ? 'エラー' : issue.severity === 'warning' ? '注意' : '情報'}</b><p>{issue.message}</p><small>{issue.field ? `${issue.field}・` : ''}{issue.code}</small></article>)}</div>
      )}
      {studio.bundle && !issues.some(({ severity }) => severity === 'error') && <div className="success-card"><b>検証に合格しました</b><span>{studio.bundle.files.length}ファイル、{formatBytes(studio.bundle.files.reduce((sum, file) => sum + file.byteLength, 0))}</span></div>}
    </section>
  );
}

function FileInspector({ file }: { file: ArtifactFile | null }) {
  if (!file) return <p className="muted">ファイルを選ぶと内容を確認できます。</p>;
  return (
    <article className="file-inspector"><header><b>{file.path}</b><span>{formatBytes(file.byteLength)}・{file.sha256.slice(0, 12)}</span></header>{file.text ? <pre>{file.text}</pre> : <div className="binary-note">バイナリ画像（{file.mimeType}）</div>}</article>
  );
}

function PublishStep({ studio }: { studio: StudioController }) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  useEffect(() => setReviewed(false), [studio.prepared?.id]);
  const draft = studio.draft!;
  const selected = studio.bundle?.files.find(({ path }) => path === selectedPath) ?? null;
  return (
    <section className="step-panel" data-testid="step-publish">
      <div className="step-intro"><span>5</span><div><h2>GitHubへ反映</h2><p>専用ブランチへ1コミットでpushし、PRを作成します。masterへ直接pushしません。</p></div></div>
      <article className="connection-card card">
        <div className="section-heading"><div><h3>{studio.repositoryStatus.mode === 'mock' ? 'モック接続' : 'GitHub App接続'}</h3><p>{studio.repositoryStatus.message}</p></div><Status value={studio.repositoryStatus.connected ? '接続済み' : '未接続'} good={studio.repositoryStatus.connected} /></div>
        {studio.repositoryStatus.mode === 'server' && <div className="button-row"><button type="button" className="primary" onClick={studio.login}>GitHubへログイン</button><button type="button" className="secondary" onClick={() => void studio.logout()}>ログアウト</button></div>}
        <p className="security-note">トークンや秘密鍵はブラウザへ保存しません。実連携は同一オリジンのサーバーだけがGitHub APIへ接続します。</p>
        {studio.repositoryStatus.mode === 'server' && <p className="warning-text">外部通信あり・料金が発生する可能性あり。公開準備とPR作成は、表示中の生成ファイルをGitHubへ送信します。</p>}
      </article>
      {studio.repositoryStatus.mode === 'mock' && <Field label="失敗状態の再現"><select value={draft.mockScenario} onChange={(event) => studio.updateDraft((current) => ({ ...current, mockScenario: event.target.value as typeof current.mockScenario }))}><option value="success">成功</option><option value="network-offline">通信切断</option><option value="tests-failed">テスト失敗</option><option value="conflict">GitHub競合</option></select></Field>}
      <h3 className="subheading">PRの後</h3>
      <div className="publish-mode-list" role="radiogroup" aria-label="反映方法">
        <button type="button" role="radio" aria-checked={draft.publishMode === 'pr-only'} className={draft.publishMode === 'pr-only' ? 'active' : ''} onClick={() => studio.updateDraft((current) => ({ ...current, publishMode: 'pr-only' }))} data-testid="publish-mode-pr"><b>PRだけ作る</b><small>内容を確認してから手動でマージ</small></button>
        <button type="button" role="radio" aria-checked={draft.publishMode === 'merge-after-ci'} className={draft.publishMode === 'merge-after-ci' ? 'active' : ''} onClick={() => studio.updateDraft((current) => ({ ...current, publishMode: 'merge-after-ci' }))} data-testid="publish-mode-merge"><b>CI成功後にマージ</b><small>実行直前にもう一度確認。失敗・競合時は中断</small></button>
      </div>
      <div className="button-grid"><button type="button" className="secondary" onClick={() => void studio.downloadMotionZip()} disabled={draft.generatedClips.length !== 5}>モーションZIP</button><button type="button" className="secondary" onClick={() => void studio.downloadJson()}>下書きJSON</button></div>
      <h3>生成予定ファイル</h3><p className="support-note">公開上限: 1ファイル{((studio.repositoryStatus.publishLimits ?? PUBLISH_LIMITS).maxFileBytes / 1024 ** 2) + ' MiB'}・合計{((studio.repositoryStatus.publishLimits ?? PUBLISH_LIMITS).maxTotalFileBytes / 1024 ** 2) + ' MiB'}・{(studio.repositoryStatus.publishLimits ?? PUBLISH_LIMITS).maxFiles}件・送信時{((studio.repositoryStatus.publishLimits ?? PUBLISH_LIMITS).maxRequestBytes / 1024 ** 2) + ' MiB'}。ZIPの全体カタログは参考データです。公開差分はGitHubのsnapshotで再構成します。</p>
      {!studio.bundle ? <p className="support-note">先に「検証」で生成ファイルを作成してください。</p> : <div className="file-list">{studio.bundle.files.map((file) => <button type="button" className={selectedPath === file.path ? 'active' : ''} key={file.path} onClick={() => setSelectedPath(file.path)}><span>{file.path}</span><small>{formatBytes(file.byteLength)}</small></button>)}</div>}
      <FileInspector file={selected} />
      {studio.bundle && <details className="controls-card"><summary>PR本文プレビュー</summary><pre>{studio.bundle.prBody}</pre></details>}
      <button type="button" className="primary full-width" disabled={studio.busy || draft.generatedClips.length !== 5 || !draft.character.id || !draft.character.displayName} onClick={() => void studio.prepareChange()} data-testid="prepare-change">{studio.bundle ? '同じ操作の確認・再試行' : '公開準備・差分を確認'}</button>
      {studio.repositoryStatus.mode === 'server' && studio.prepared && studio.pullRequest && !studio.pullRequest.merged && <button type="button" className="secondary full-width" disabled={studio.busy} onClick={() => void studio.reprepareLatest()} data-testid="reprepare-latest">最新masterで差分を作り直す（元PRを保持）</button>}
      {studio.prepared?.latestBaseSha && studio.prepared.latestBaseSha !== studio.prepared.commitSha && <p className="warning-card">masterが更新されています。同じ操作の再試行は元PRを確認します。公開を続けるには最新masterで差分を作り直してください。</p>}
      {studio.prepared?.predecessor && <p className="support-note">後継操作です。<a href={studio.prepared.predecessor.url} target="_blank" rel="noreferrer">元PR #{studio.prepared.predecessor.number}（保持）</a>から引き継ぎ、新しい差分とCIを確認します。</p>}
      {studio.prepared && <div className="result-card"><dl className="facts facts--compact"><div><dt>ブランチ</dt><dd>{studio.prepared.branch}</dd></div><div><dt>基準SHA</dt><dd>{studio.prepared.commitSha.slice(0, 12)}</dd></div><div><dt>生成物検証</dt><dd>{studio.prepared.testStatus}（CIはPR作成後）</dd></div><div><dt>変更</dt><dd>{studio.prepared.files.length}件</dd></div></dl><details><summary>差分を表示</summary><pre>{studio.prepared.diff}</pre></details></div>}
      {studio.prepared && <section className="card publish-review"><h3>公開する正確な差分</h3>{studio.prepared.files.map(file => <details key={file.path}><summary>{file.path}・{formatBytes(file.byteLength)}</summary><code>SHA256 {file.sha256}</code>{file.text && <pre>{file.text}</pre>}</details>)}<label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} data-testid="review-publish-diff" />この基準SHAと差分を確認した</label></section>}
      <button type="button" className="primary full-width" disabled={!reviewed || !studio.prepared || studio.prepared.testStatus !== 'success' || studio.busy} onClick={() => void studio.createPullRequest()} data-testid="create-pr">{draft.publishMode === 'merge-after-ci' ? 'PR作成 → CI成功後にマージ' : 'PRを作成'}</button>
      {studio.pullRequest && <div className="success-card" data-testid="publish-complete"><b>{studio.pullRequest.merged ? 'PRを作成してマージしました' : 'PRを作成しました'}</b><span>#{studio.pullRequest.number}・CI {studio.pullRequest.checks}・{studio.pullRequest.merged ? studio.pullRequest.deployment === 'published' ? '配備済み' : 'マージ済み・配備待ち（' + studio.pullRequest.deployment + ')' : 'PR作成済み・未マージ'}</span><a href={studio.pullRequest.url} target="_blank" rel="noreferrer">PRを開く</a></div>}
    </section>
  );
}

function CompleteStep({ studio }: { studio: StudioController }) {
  const result = studio.pullRequest;
  return (
    <section className="step-panel complete-panel" data-testid="step-complete">
      <div className="completion-mark" aria-hidden="true">✓</div>
      <h2>登録準備が完了しました</h2>
      <p>{studio.repositoryStatus.mode === 'mock' ? 'モックPR、CI、公開確認まで一連の流れを完走しました。' : 'PRを作成しました。CIと公開状態を確認してください。'}</p>
      {result ? <dl className="facts"><div><dt>PR</dt><dd>#{result.number}</dd></div><div><dt>ブランチ</dt><dd>{result.branch}</dd></div><div><dt>CI</dt><dd>{result.checks}</dd></div><div><dt>公開</dt><dd>{result.deployment}</dd></div><div><dt>URL</dt><dd>{result.url}</dd></div></dl> : <p className="warning-text">PR結果がまだありません。前の画面でPRを作成してください。</p>}
      <button type="button" className="primary full-width" onClick={() => void studio.backToDashboard()}>ダッシュボードへ戻る</button>
      <button type="button" className="secondary full-width" onClick={() => void studio.createNewDraft()}>次のキャラクターを追加</button>
    </section>
  );
}

function Workflow({ studio }: { studio: StudioController }) {
  const title = studio.draft?.title || 'モーション制作';
  return (
    <div className="workflow">
      <header className="workflow-header">
        <button type="button" className="icon-button" aria-label="ダッシュボードへ戻る" onClick={() => void studio.backToDashboard()}>‹</button>
        <div><b>{title}</b><span>{studio.saveState === 'pending' ? '保存中…' : studio.saveState === 'error' ? '保存エラー' : `自動保存済み ${formatDate(studio.savedAt)}`}</span></div>
        <span className="step-count">{studio.stepIndex + 1}/{WORKFLOW_STEPS.length}</span>
      </header>
      <nav className="step-grid" aria-label="作業ステップ">
        {WORKFLOW_STEPS.map((item, index) => <button type="button" key={item.id} data-testid={`step-nav-${item.id}`} className={`${studio.step === item.id ? 'active' : ''} ${index < studio.stepIndex ? 'done' : ''}`} onClick={() => studio.goToStep(item.id)}><span>{index + 1}</span><small>{item.label}</small></button>)}
      </nav>
      <main className="workflow-main">
        {studio.step === 'image' && <><ImageStep studio={studio} />{studio.draft?.imageInfo && <CutoutStep studio={studio} embedded />}</>}
        {studio.step === 'setup' && <LandmarkEditor studio={studio} />}
        {studio.step === 'motion' && <MotionStep studio={studio} />}
        {studio.step === 'character' && <CharacterStep studio={studio} />}
        {studio.step === 'publish' && <PublishStep studio={studio} />}
      </main>
      <nav className="bottom-actions" aria-label="ステップ移動">
        <button type="button" className="secondary" onClick={studio.previousStep}>戻る</button>
        {studio.step === 'publish'
          ? <button type="button" className="primary" onClick={() => void studio.backToDashboard()}>保存して終了</button>
          : <button type="button" className="primary" disabled={studio.step === 'image' ? !studio.draft?.imageInfo : studio.step === 'motion' ? studio.draft?.generatedClips.length !== 5 : studio.step === 'character' ? !studio.draft?.character.id || !studio.draft.character.displayName : false} onClick={studio.nextStep}>次へ</button>}
      </nav>
    </div>
  );
}

export default function App() {
  const studio = useStudioController();
  const [updateRegistration, setUpdateRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    const handler = (event: Event) => setUpdateRegistration((event as CustomEvent<ServiceWorkerRegistration>).detail);
    window.addEventListener('content-studio-update', handler);
    return () => window.removeEventListener('content-studio-update', handler);
  }, []);

  return (
    <div className="app-shell">
      {studio.view === 'dashboard' ? <Dashboard studio={studio} /> : <Workflow studio={studio} />}
      {studio.notice && <div className="toast toast--notice" role="status"><span>{studio.notice}</span><button type="button" onClick={studio.dismissNotice} aria-label="通知を閉じる">×</button></div>}
      {studio.error && <div className="toast toast--error" role="alert"><span>{studio.error}</span><button type="button" onClick={studio.dismissError} aria-label="エラーを閉じる">×</button></div>}
      {updateRegistration && <div className="update-banner"><span>Content Studioの更新があります。</span><button type="button" onClick={() => updateRegistration.waiting?.postMessage({ type: 'SKIP_WAITING' })}>更新する</button></div>}
      {studio.busy && studio.step !== 'motion' && <div className="busy-overlay" role="dialog" aria-modal="true" aria-label="処理中"><div><span className="spinner" /><b>{studio.progress?.label ?? '処理しています…'}</b><progress max={1} value={studio.progress?.value ?? undefined} /><small>{studio.progress ? `${Math.round(studio.progress.value * 100)}%` : '入力内容は自動保存されています'}</small><button type="button" className="secondary" onClick={studio.cancelProcessing}>{studio.step === 'publish' ? '待機を終了（送信済み操作は取り消せません）' : '処理を中止'}</button></div></div>}
    </div>
  );
}
