import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  ArtifactFile,
  CharacterForm,
  ImageEditorState,
  MotionAction,
  MotionActionPreset,
  MotionParameters,
  PreviewSettings,
  SkillParameters,
  SpecialTemplate,
} from './domain/types';
import { WORKFLOW_STEPS } from './domain/types';
import { ACTION_LABELS, getActionPreset, listActionPresets } from './motion';
import { ImageCanvas } from './components/ImageCanvas';
import { MotionPreview } from './components/MotionPreview';
import { PartPreview } from './components/PartPreview';
import { useStudioController, type StudioController } from './app/use-studio-controller';

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

function ParameterStepper({ label, value, min, max, step = 1, suffix = '', digits = 0, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  digits?: number;
  onChange: (value: number) => void;
}) {
  const change = (direction: -1 | 1) => {
    const next = Math.max(min, Math.min(max, Number((value + step * direction).toFixed(Math.max(digits, 4)))));
    onChange(next);
  };
  return (
    <div className="parameter-stepper">
      <span>{label}</span>
      <div>
        <button type="button" aria-label={`${label}を減らす`} disabled={value <= min} onClick={() => change(-1)}>−</button>
        <output>{value.toFixed(digits)}{suffix}</output>
        <button type="button" aria-label={`${label}を増やす`} disabled={value >= max} onClick={() => change(1)}>＋</button>
      </div>
    </div>
  );
}

function Status({ value, good }: { value: string; good?: boolean }) {
  return <span className={`status-pill ${good ? 'status-pill--good' : ''}`}>{value}</span>;
}

function Dashboard({ studio }: { studio: StudioController }) {
  const importRef = useRef<HTMLInputElement>(null);
  const detectedCount = studio.drafts.filter((draft) => draft.partDetection.status === 'ready').length;
  return (
    <main className="dashboard" data-testid="dashboard">
      <header className="hero">
        <div>
          <p className="eyebrow">対象ゲーム モーション制作</p>
          <h1>Content Studio</h1>
          <p>Androidだけで、切り抜き・部位候補・動作・スプライト出力まで。</p>
        </div>
        <span className="version">v{studio.appVersion}</span>
      </header>

      <section className="summary-grid" aria-label="運用状況">
        <article><strong>{studio.drafts.length}</strong><span>下書き</span></article>
        <article><strong>{detectedCount}</strong><span>部位検出済み</span></article>
        <article><strong>512</strong><span>標準画質 px</span></article>
        <article><strong>{studio.capabilities.online ? '端末内' : 'オフライン'}</strong><span>処理方式</span></article>
      </section>

      <button className="primary hero-action" type="button" onClick={() => void studio.createNewDraft()} data-testid="add-character">
        <span aria-hidden="true">＋</span> モーションを新規作成
      </button>

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
    </section>
  );
}

function CutoutStep({ studio }: { studio: StudioController }) {
  const [compare, setCompare] = useState<'before' | 'after'>('after');
  const draft = studio.draft!;
  const editor = draft.editor;
  const changeEditor = <K extends keyof ImageEditorState>(key: K, value: ImageEditorState[K]) => studio.updateDraft((current) => ({ ...current, editor: { ...current.editor, [key]: value } }));
  const pixels = compare === 'before' ? studio.processed?.original : studio.processed?.edited;
  return (
    <section className="step-panel" data-testid="step-cutout">
      <div className="step-intro"><span>2</span><div><h2>背景除去と切り抜き</h2><p>端末内だけで処理します。画像を外部へ送信しません。</p></div></div>
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
  const setMotion = <K extends keyof MotionParameters>(key: K, value: MotionParameters[K]) => studio.updateDraft((current) => ({ ...current, motion: { ...current.motion, [key]: value } }));
  const selectPreset = (id: MotionActionPreset) => {
    const preset = getActionPreset(id);
    studio.updateDraft((current) => ({
      ...current,
      motionAction: preset.action,
      actionPreset: preset.id,
      motionPreset: preset.motionPreset,
      motion: {
        ...structuredClone(preset.parameters),
        outputSize: current.motion.outputSize,
        lightweightPreview: current.motion.lightweightPreview,
        flipHorizontal: current.motion.flipHorizontal,
      },
    }));
  };
  const selectAction = (action: MotionAction) => {
    const first = listActionPresets(action)[0];
    if (first) selectPreset(first.id);
  };
  const activePreset = getActionPreset(draft.actionPreset);
  const quality = draft.motion.outputSize >= 512 ? '高画質 512px' : '軽量 256px';
  return (
    <section className="step-panel" data-testid="step-motion">
      <div className="step-intro"><span>4</span><div><h2>動作を選ぶ</h2><p>先に動作、その次にプリセットを選びます。必要なときだけ微調整を開けます。</p></div></div>
      <div className="action-card-grid" role="group" aria-label="動作の種類">
        {(Object.keys(ACTION_LABELS) as MotionAction[]).map((action) => (
          <button type="button" key={action} className={draft.motionAction === action ? 'active' : ''} onClick={() => selectAction(action)} data-testid={`motion-action-${action}`}>
            <b>{ACTION_LABELS[action].label}</b><small>{ACTION_LABELS[action].description}</small>
          </button>
        ))}
      </div>
      <h3 className="subheading">プリセット</h3>
      <div className="preset-card-list">
        {listActionPresets(draft.motionAction).map((preset) => (
          <button type="button" key={preset.id} className={draft.actionPreset === preset.id ? 'active' : ''} onClick={() => selectPreset(preset.id)} data-testid={`action-preset-${preset.id}`}>
            <span><b>{preset.label}</b><small>{preset.description}</small></span><span aria-hidden="true">{draft.actionPreset === preset.id ? '✓' : '›'}</span>
          </button>
        ))}
      </div>
      <div className="quality-selector">
        <div><b>生成画質</b><small>普段は高画質がおすすめです</small></div>
        <div className="segmented">
          <button type="button" className={draft.motion.outputSize === 512 ? 'active' : ''} onClick={() => setMotion('outputSize', 512)}>高画質</button>
          <button type="button" className={draft.motion.outputSize === 256 ? 'active' : ''} onClick={() => setMotion('outputSize', 256)}>軽量</button>
        </div>
      </div>
      <MotionPreview sprite={studio.sprite} fallback={studio.processed?.normalized.pixels ?? null} settings={draft.preview} label={`${ACTION_LABELS[draft.motionAction].label}モーションプレビュー`} />
      <button type="button" className="secondary full-width" disabled={!studio.sprite} onClick={() => studio.updateDraft((current) => ({ ...current, preview: { ...current.preview, playing: !current.preview.playing } }))}>
        {studio.sprite ? (draft.preview.playing ? 'プレビュー停止' : 'プレビュー再生') : '生成後に再生できます'}
      </button>
      <p className="support-note">{activePreset.description} 画像の顔・装備・色は生成せず、決定的な2D変形だけを使います。</p>
      <details className="controls-card fine-tune-card">
        <summary>微調整（必要なときだけ）</summary>
        <p className="field-help">スライダーは使わず、大きい− / ＋ボタンで誤操作を防ぎます。</p>
        <div className="segmented"><button type="button" className={draft.motion.frameCount === 8 ? 'active' : ''} onClick={() => setMotion('frameCount', 8)}>8フレーム</button><button type="button" className={draft.motion.frameCount === 12 ? 'active' : ''} onClick={() => setMotion('frameCount', 12)}>12フレーム</button></div>
        <ParameterStepper label="FPS" value={draft.motion.fps} min={4} max={30} step={1} onChange={(value) => setMotion('fps', value)} />
        <ParameterStepper label="上下移動" value={draft.motion.moveY} min={-32} max={32} step={1} suffix="px" onChange={(value) => setMotion('moveY', value)} />
        <ParameterStepper label="横移動" value={draft.motion.moveX} min={-32} max={32} step={1} suffix="px" onChange={(value) => setMotion('moveX', value)} />
        <ParameterStepper label="拡大縮小" value={draft.motion.scaleAmount} min={0} max={0.08} step={0.002} digits={3} onChange={(value) => setMotion('scaleAmount', value)} />
        <ParameterStepper label="潰れ・伸び" value={draft.motion.squashAmount} min={0} max={0.1} step={0.002} digits={3} onChange={(value) => setMotion('squashAmount', value)} />
        <ParameterStepper label="回転" value={draft.motion.rotationDegrees} min={-10} max={10} step={0.25} digits={2} suffix="°" onChange={(value) => setMotion('rotationDegrees', value)} />
        <ParameterStepper label="揺れの強さ" value={draft.motion.intensity} min={0} max={2} step={0.1} digits={1} onChange={(value) => setMotion('intensity', value)} />
        <ParameterStepper label="キャンバス余白" value={draft.motion.canvasPadding} min={0} max={96} step={4} suffix="px" onChange={(value) => setMotion('canvasPadding', value)} />
        <Toggle label="モーション側でも左右反転" checked={draft.motion.flipHorizontal} onChange={(checked) => setMotion('flipHorizontal', checked)} />
      </details>
      <button className="primary full-width generate-motion-button" type="button" disabled={studio.busy || !draft.imageInfo} onClick={() => void studio.generateMotion()} data-testid="generate-motion">
        {studio.sprite ? '設定を反映して再生成' : `${ACTION_LABELS[draft.motionAction].label}モーションを生成`}
      </button>
      {studio.sprite && <dl className="facts facts--compact"><div><dt>画質</dt><dd>{studio.sprite.metadata.frameWidth >= 512 ? '高画質 512px' : '軽量 256px'}</dd></div><div><dt>容量</dt><dd>{formatBytes(studio.sprite.spriteSheetPng.byteLength)}</dd></div><div><dt>再生</dt><dd>{studio.sprite.metadata.frameCount}枚 / {studio.sprite.metadata.fps}fps</dd></div><div><dt>処理</dt><dd>{studio.sprite.usedWorker ? 'Worker' : '軽量代替'}</dd></div></dl>}
      {!studio.sprite && <p className="field-help">現在の設定: {quality}</p>}
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
  const draft = studio.draft!;
  const selected = studio.bundle?.files.find(({ path }) => path === selectedPath) ?? null;
  return (
    <section className="step-panel" data-testid="step-publish">
      <div className="step-intro"><span>8</span><div><h2>GitHub反映</h2><p>mainへ直接反映せず、専用ブランチの1コミットとPRを作ります。</p></div></div>
      <article className="connection-card card">
        <div className="section-heading"><div><h3>{studio.repositoryStatus.mode === 'mock' ? 'モック接続' : 'GitHub App接続'}</h3><p>{studio.repositoryStatus.message}</p></div><Status value={studio.repositoryStatus.connected ? '接続済み' : '未接続'} good={studio.repositoryStatus.connected} /></div>
        {studio.repositoryStatus.mode === 'server' && <div className="button-row"><button type="button" className="primary" onClick={studio.login}>GitHubへログイン</button><button type="button" className="secondary" onClick={() => void studio.logout()}>ログアウト</button></div>}
        <p className="security-note">トークンや秘密鍵はブラウザへ保存しません。実連携は同一オリジンのサーバーだけがGitHub APIへ接続します。</p>
        {studio.repositoryStatus.mode === 'server' && <p className="warning-text">外部通信あり・料金が発生する可能性あり。公開準備とPR作成は、表示中の生成ファイルをGitHubへ送信します。</p>}
      </article>
      {studio.repositoryStatus.mode === 'mock' && <Field label="失敗状態の再現"><select value={draft.mockScenario} onChange={(event) => studio.updateDraft((current) => ({ ...current, mockScenario: event.target.value as typeof current.mockScenario }))}><option value="success">成功</option><option value="network-offline">通信切断</option><option value="tests-failed">テスト失敗</option><option value="conflict">GitHub競合</option></select></Field>}
      <div className="button-grid"><button type="button" className="secondary" onClick={() => void studio.downloadZip()} disabled={!studio.bundle}>ZIP出力</button><button type="button" className="secondary" onClick={() => void studio.downloadJson()}>下書きJSON</button></div>
      <h3>生成予定ファイル</h3>
      {!studio.bundle ? <p className="support-note">先に「検証」で生成ファイルを作成してください。</p> : <div className="file-list">{studio.bundle.files.map((file) => <button type="button" className={selectedPath === file.path ? 'active' : ''} key={file.path} onClick={() => setSelectedPath(file.path)}><span>{file.path}</span><small>{formatBytes(file.byteLength)}</small></button>)}</div>}
      <FileInspector file={selected} />
      {studio.bundle && <details className="controls-card"><summary>PR本文プレビュー</summary><pre>{studio.bundle.prBody}</pre></details>}
      <button type="button" className="primary full-width" disabled={!studio.bundle || studio.busy} onClick={() => void studio.prepareChange()} data-testid="prepare-change">変更を準備・テスト</button>
      {studio.prepared && <div className="result-card"><dl className="facts facts--compact"><div><dt>ブランチ</dt><dd>{studio.prepared.branch}</dd></div><div><dt>コミット</dt><dd>{studio.prepared.commitSha.slice(0, 12)}</dd></div><div><dt>自動テスト</dt><dd>{studio.prepared.testStatus}</dd></div><div><dt>変更</dt><dd>{studio.prepared.files.length}件</dd></div></dl><details><summary>差分を表示</summary><pre>{studio.prepared.diff}</pre></details></div>}
      <button type="button" className="primary full-width" disabled={!studio.prepared || studio.prepared.testStatus !== 'success' || studio.busy} onClick={() => void studio.createPullRequest()} data-testid="create-pr">PRを作成</button>
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
        {studio.step === 'image' && <ImageStep studio={studio} />}
        {studio.step === 'cutout' && <CutoutStep studio={studio} />}
        {studio.step === 'parts' && <PartsStep studio={studio} />}
        {studio.step === 'motion' && <MotionStep studio={studio} />}
        {studio.step === 'preview' && <PreviewStep studio={studio} />}
        {studio.step === 'export' && <ExportStep studio={studio} />}
      </main>
      <nav className="bottom-actions" aria-label="ステップ移動"><button type="button" className="secondary" onClick={studio.previousStep}>戻る</button>{studio.step === 'export' ? <button type="button" className="primary" disabled={!studio.sprite} onClick={() => void studio.downloadMotionZip()}>ZIP保存</button> : <button type="button" className="primary" onClick={studio.nextStep}>次へ</button>}</nav>
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
      {studio.busy && <div className="busy-overlay" role="dialog" aria-modal="true" aria-label="処理中"><div><span className="spinner" /><b>{studio.progress?.label ?? '処理しています…'}</b><progress max={1} value={studio.progress?.value ?? undefined} /><small>{studio.progress ? `${Math.round(studio.progress.value * 100)}%` : '入力内容は自動保存されています'}</small><button type="button" className="secondary" onClick={studio.cancelProcessing}>処理を中止</button></div></div>}
    </div>
  );
}
