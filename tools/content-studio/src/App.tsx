import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ArtifactFile, CharacterForm, ImageEditorState, MotionParameters, MotionPreset, PreviewSettings, SkillParameters, SpecialTemplate } from './domain/types';
import { WORKFLOW_STEPS } from './domain/types';
import { MOTION_PRESETS } from './motion';
import { ImageCanvas } from './components/ImageCanvas';
import { MotionPreview } from './components/MotionPreview';
import { REGISTERED_LEGACY_CHARACTER_COUNT, useStudioController, type StudioController } from './app/use-studio-controller';

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

function Status({ value, good }: { value: string; good?: boolean }) {
  return <span className={`status-pill ${good ? 'status-pill--good' : ''}`}>{value}</span>;
}

function Dashboard({ studio }: { studio: StudioController }) {
  const importRef = useRef<HTMLInputElement>(null);
  const dirtyCount = studio.drafts.filter((draft) => draft.historyStatus === 'dirty').length + studio.outbox.length;
  return (
    <main className="dashboard" data-testid="dashboard">
      <header className="hero">
        <div>
          <p className="eyebrow">対象ゲーム 管理ツール</p>
          <h1>Content Studio</h1>
          <p>Androidだけで、画像からPRまで。通常運用は生成AIを使いません。</p>
        </div>
        <span className="version">v{studio.appVersion}</span>
      </header>

      <section className="summary-grid" aria-label="運用状況">
        <article><strong>{REGISTERED_LEGACY_CHARACTER_COUNT + studio.publishedCharacters.length}</strong><span>登録済み</span></article>
        <article><strong>{studio.drafts.length}</strong><span>下書き</span></article>
        <article><strong>{dirtyCount}</strong><span>未反映</span></article>
        <article><strong>{studio.repositoryStatus.build}</strong><span>最新ビルド</span></article>
      </section>

      <button className="primary hero-action" type="button" onClick={() => void studio.createNewDraft()} data-testid="add-character">
        <span aria-hidden="true">＋</span> キャラクターを追加
      </button>

      <section className="card connection-card">
        <div className="section-heading">
          <div><h2>接続状態</h2><p>{studio.repositoryStatus.message}</p></div>
          <Status value={studio.repositoryStatus.mode === 'mock' ? 'モック' : studio.repositoryStatus.connected ? '接続済み' : '未接続'} good={studio.repositoryStatus.connected} />
        </div>
        <dl className="facts facts--compact">
          <div><dt>ユーザー</dt><dd>{studio.repositoryStatus.user ?? '未ログイン'}</dd></div>
          <div><dt>CI</dt><dd>{studio.repositoryStatus.build}</dd></div>
          <div><dt>公開</dt><dd>{studio.repositoryStatus.deployment}</dd></div>
          <div><dt>通信</dt><dd>{studio.capabilities.online ? 'オンライン' : 'オフライン'}</dd></div>
        </dl>
        <div className="button-row">
          <button type="button" className="secondary" onClick={() => void studio.refreshRepositoryStatus()}>再確認</button>
          {studio.installAvailable && <button type="button" className="secondary" onClick={() => void studio.installApp()}>アプリをインストール</button>}
        </div>
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

      <section className="section-block">
        <div className="section-heading"><div><h2>Content Studio登録済み</h2><p>正規データから安全に更新用下書きを作成します。</p></div></div>
        {studio.publishedWarning && <p className="warning-text">{studio.publishedWarning}</p>}
        {studio.publishedCharacters.length === 0 ? <p className="muted">新方式で登録されたキャラクターはまだありません。</p> : (
          <div className="draft-list">{studio.publishedCharacters.slice(0, 8).map((record) => (
            <article className="history-row" key={record.character.id}>
              <span><b>{record.character.displayName}</b><small>{record.character.slug}・v{record.character.implementationVersion}</small></span>
              <button type="button" className="secondary compact-button" onClick={() => void studio.editPublishedCharacter(record.character.slug)}>更新</button>
            </article>
          ))}</div>
        )}
      </section>

      {studio.outbox.length > 0 && (
        <section className="section-block">
          <h2>通信待ち</h2>
          {studio.outbox.map((item) => (
            <article className="card" key={item.id}>
              <p>{item.bundle.character.displayName}・再試行 {item.attempts}回</p>
              <button className="secondary" type="button" disabled={!studio.capabilities.online} onClick={() => void studio.retryOutbox(item.id)}>再送する</button>
            </article>
          ))}
        </section>
      )}

      <section className="section-block">
        <h2>最近の完了</h2>
        {studio.history.length === 0 ? <p className="muted">完了履歴はまだありません。</p> : studio.history.slice(0, 4).map((item) => (
          <article className="history-row" key={item.id}><span><b>{item.displayName}</b><small>{formatDate(item.completedAt)}</small></span><Status value={item.result.checks} good={item.result.checks === 'success'} /></article>
        ))}
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
      <div className="tool-selector" role="group" aria-label="補正ブラシ">
        {(['pan', 'erase', 'restore'] as const).map((tool) => <button type="button" key={tool} className={editor.tool === tool ? 'active' : ''} onClick={() => changeEditor('tool', tool)}>{tool === 'pan' ? '確認' : tool === 'erase' ? '消しゴム' : '復元ブラシ'}</button>)}
      </div>
      <RangeField label="ブラシサイズ" value={editor.brushSize} min={4} max={160} suffix="px" onChange={(value) => changeEditor('brushSize', value)} />
      <RangeField label="拡大表示" value={editor.zoom} min={1} max={3} step={0.1} suffix="倍" onChange={(value) => changeEditor('zoom', value)} />
      <details className="controls-card" open>
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

function MotionStep({ studio }: { studio: StudioController }) {
  const draft = studio.draft!;
  const setMotion = <K extends keyof MotionParameters>(key: K, value: MotionParameters[K]) => studio.updateDraft((current) => ({ ...current, motion: { ...current.motion, [key]: value } }));
  const setPreset = (preset: MotionPreset) => studio.updateDraft((current) => ({ ...current, motionPreset: preset, motion: structuredClone(MOTION_PRESETS[preset].parameters) }));
  return (
    <section className="step-panel" data-testid="step-motion">
      <div className="step-intro"><span>3</span><div><h2>待機モーション</h2><p>元画像へ周期的な2D変形だけを加えます。顔や装備は生成しません。</p></div></div>
      <MotionPreview sprite={studio.sprite} fallback={studio.processed?.normalized.pixels ?? null} settings={draft.preview} />
      <button type="button" className="secondary full-width" onClick={() => studio.updateDraft((current) => ({ ...current, preview: { ...current.preview, playing: !current.preview.playing } }))}>{draft.preview.playing ? 'プレビュー停止' : 'プレビュー再生'}</button>
      <Field label="プリセット">
        <select value={draft.motionPreset} onChange={(event) => setPreset(event.target.value as MotionPreset)}>
          {Object.values(MOTION_PRESETS).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </Field>
      <p className="field-help">{MOTION_PRESETS[draft.motionPreset].description}</p>
      <div className="two-columns">
        <Field label="フレーム数"><select value={draft.motion.frameCount} onChange={(event) => setMotion('frameCount', Number(event.target.value) as 8 | 12)}><option value="8">8</option><option value="12">12</option></select></Field>
        <Field label="FPS"><input type="number" inputMode="decimal" min="1" max="30" value={draft.motion.fps} onChange={(event) => setMotion('fps', Number(event.target.value))} /></Field>
      </div>
      <RangeField label="上下移動" value={draft.motion.moveY} min={-20} max={20} step={0.5} suffix="px" onChange={(value) => setMotion('moveY', value)} />
      <RangeField label="横移動" value={draft.motion.moveX} min={-20} max={20} step={0.5} suffix="px" onChange={(value) => setMotion('moveX', value)} />
      <RangeField label="拡大縮小" value={draft.motion.scaleAmount} min={0} max={0.08} step={0.001} onChange={(value) => setMotion('scaleAmount', value)} />
      <RangeField label="潰れ・伸び" value={draft.motion.squashAmount} min={0} max={0.1} step={0.001} onChange={(value) => setMotion('squashAmount', value)} />
      <RangeField label="回転" value={draft.motion.rotationDegrees} min={-8} max={8} step={0.1} suffix="°" onChange={(value) => setMotion('rotationDegrees', value)} />
      <RangeField label="待機中の間" value={draft.motion.idlePause} min={0} max={0.8} step={0.01} onChange={(value) => setMotion('idlePause', value)} />
      <RangeField label="地面への接地点" value={draft.motion.groundContact} min={0.5} max={1} step={0.01} onChange={(value) => setMotion('groundContact', value)} />
      <RangeField label="揺れの強さ" value={draft.motion.intensity} min={0} max={2} step={0.05} onChange={(value) => setMotion('intensity', value)} />
      <RangeField label="キャンバス余白" value={draft.motion.canvasPadding} min={0} max={96} suffix="px" onChange={(value) => setMotion('canvasPadding', value)} />
      <Toggle label="低性能端末向け軽量プレビュー" checked={draft.motion.lightweightPreview} onChange={(checked) => setMotion('lightweightPreview', checked)} />
      <Toggle label="モーション側でも左右反転" checked={draft.motion.flipHorizontal} onChange={(checked) => setMotion('flipHorizontal', checked)} />
      <button className="primary full-width" type="button" disabled={studio.busy || !draft.imageInfo} onClick={() => void studio.generateMotion()} data-testid="generate-motion">スプライトシートを生成</button>
      {studio.sprite && <dl className="facts facts--compact"><div><dt>シート</dt><dd>{studio.sprite.sheet.width} × {studio.sprite.sheet.height}px</dd></div><div><dt>容量</dt><dd>{formatBytes(studio.sprite.spriteSheetPng.byteLength)}</dd></div><div><dt>ループ</dt><dd>{studio.sprite.metadata.frameCount}枚 / {studio.sprite.metadata.fps}fps</dd></div><div><dt>基準点</dt><dd>{studio.sprite.metadata.anchorX.toFixed(2)}, {studio.sprite.metadata.anchorY.toFixed(2)}</dd></div></dl>}
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
  const c = draft.character;
  return (
    <section className="step-panel" data-testid="step-preview">
      <div className="step-intro"><span>6</span><div><h2>ゲーム相当プレビュー</h2><p>一覧サイズ、向き、背景、基準点と当たり判定候補を確認します。</p></div></div>
      <article className="game-preview-card" style={{ '--character-color': c.color } as CSSProperties}>
        <MotionPreview sprite={studio.sprite} fallback={studio.processed?.normalized.pixels ?? null} settings={draft.preview} metadata={studio.sprite?.metadata} label="ゲーム内プレビュー" />
        <div className="game-preview-card__copy"><span>{c.classification || 'キャラクター'}</span><h3>{c.displayName || '名称未入力'}</h3><p>{c.description || 'キャラクター説明がここに表示されます。'}</p></div>
        <div className="stats-strip"><span>HP <b>{c.maxHp}</b></span><span>攻 <b>{c.attack}</b></span><span>防 <b>{c.defense}</b></span><span>速 <b>{c.speed}</b></span></div>
        <div className="skill-preview"><b>{c.specialName || '必殺技未入力'}</b><span>{c.specialDescription || '技の説明'}</span></div>
      </article>
      <div className="segmented segmented--three"><button type="button" className={draft.preview.background === 'light' ? 'active' : ''} onClick={() => setPreview('background', 'light')}>明るい</button><button type="button" className={draft.preview.background === 'dark' ? 'active' : ''} onClick={() => setPreview('background', 'dark')}>暗い</button><button type="button" className={draft.preview.background === 'game' ? 'active' : ''} onClick={() => setPreview('background', 'game')}>ゲーム風</button></div>
      <div className="two-columns"><Field label="向き"><select value={draft.preview.direction} onChange={(event) => setPreview('direction', event.target.value as PreviewSettings['direction'])}><option value="left">左向き</option><option value="right">右向き</option></select></Field><Field label="表示サイズ"><select value={draft.preview.size} onChange={(event) => setPreview('size', event.target.value as PreviewSettings['size'])}><option value="small">一覧・小</option><option value="normal">通常</option></select></Field></div>
      <Toggle label="基準点を表示" checked={draft.preview.showAnchor} onChange={(checked) => setPreview('showAnchor', checked)} />
      <Toggle label="当たり判定候補を表示" checked={draft.preview.showCollision} onChange={(checked) => setPreview('showCollision', checked)} />
      <Toggle label="待機モーションを再生" checked={draft.preview.playing} onChange={(checked) => setPreview('playing', checked)} />
      <dl className="facts facts--compact"><div><dt>正規化画像</dt><dd>{formatBytes(studio.processed?.variants?.normalizedPng.byteLength)}</dd></div><div><dt>軽量WebP</dt><dd>{formatBytes(studio.processed?.variants?.lightweightWebp.byteLength)}</dd></div><div><dt>スプライト</dt><dd>{formatBytes(studio.sprite?.spriteSheetPng.byteLength)}</dd></div><div><dt>推定負荷</dt><dd>{draft.motion.outputSize <= 256 && draft.motion.frameCount === 8 ? '軽量' : '標準'}</dd></div></dl>
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
  const title = studio.draft?.character.displayName || studio.draft?.title || 'キャラクター追加';
  return (
    <div className="workflow">
      <header className="workflow-header">
        <button type="button" className="icon-button" aria-label="ダッシュボードへ戻る" onClick={() => void studio.backToDashboard()}>‹</button>
        <div><b>{title}</b><span>{studio.saveState === 'pending' ? '保存中…' : studio.saveState === 'error' ? '保存エラー' : `自動保存済み ${formatDate(studio.savedAt)}`}</span></div>
        <span className="step-count">{studio.stepIndex + 1}/9</span>
      </header>
      <nav className="step-grid" aria-label="作業ステップ">
        {WORKFLOW_STEPS.map((item, index) => <button type="button" key={item.id} data-testid={`step-nav-${item.id}`} className={`${studio.step === item.id ? 'active' : ''} ${index < studio.stepIndex ? 'done' : ''}`} onClick={() => studio.goToStep(item.id)}><span>{index + 1}</span><small>{item.label}</small></button>)}
      </nav>
      <main className="workflow-main">
        {studio.step === 'image' && <ImageStep studio={studio} />}
        {studio.step === 'cutout' && <CutoutStep studio={studio} />}
        {studio.step === 'motion' && <MotionStep studio={studio} />}
        {studio.step === 'details' && <DetailsStep studio={studio} />}
        {studio.step === 'skills' && <SkillsStep studio={studio} />}
        {studio.step === 'preview' && <PreviewStep studio={studio} />}
        {studio.step === 'validate' && <ValidateStep studio={studio} />}
        {studio.step === 'publish' && <PublishStep studio={studio} />}
        {studio.step === 'complete' && <CompleteStep studio={studio} />}
      </main>
      {studio.step !== 'complete' && studio.step !== 'publish' && <nav className="bottom-actions" aria-label="ステップ移動"><button type="button" className="secondary" onClick={studio.previousStep}>戻る</button><button type="button" className="primary" onClick={studio.nextStep}>次へ</button></nav>}
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
