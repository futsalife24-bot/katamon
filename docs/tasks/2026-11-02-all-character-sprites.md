# 既存18キャラの5動作スプライト

## 現在地

- branch `feat/all-character-sprites-20261101`。baseは `48a5182a7b6d27b4838e3b18d197fe08e79890a6`（開始時の`origin/master`）。実装commit `341ed696e72bc665f484d750e6bbca0dd1d72292`を同ブランチへpush済み。作業場所は `C:/Users/futsa/Documents/Codex/2026-11-01/https-x-com-codestudiopjbk-status-2116806197743591494/katamon-integration`。未公開。
- 対象は手書き定義の既存18キャラ。各キャラの前進8、後退8、発射8、被弾12、着地8の計44コマ。全18体90動作792コマのpack、画素照合、Chromeでの読込・左右描画を確認済み。新規15体75動作のstrict QCは75/75合格。残り3体は採用済み試作を再利用した。
- 画像の変更は見た目だけ。既存の能力、物理、通信、ルール、保存形式、静止画の参照は変更しない。画像取得中・失敗時と動作終了時は既存の静止画へ戻る。右向き原画を左右へ反転表示する。
- 通常対戦の既存キャラに適用する。協力ボスunit、Firebase replay中の動作通知、リモートregistryを使う登録対戦は既存の制約を維持する。登録対戦の原画・版はローカルと一致する保証がないため、ローカル動作を重ねない。

## 素材と生成仕様

- 元の静止原画は `assets/characters/master/*.png`。採用済み試作2体の選択は `../katamon-other-characters/selected-folders.json`、にゃんタンクの採用フレームは `../katamon-sprite-pilot/*-frames-v*`。残り15体は `../all-character-sprites/selected-folders.json` が採用済み処理フォルダーを指す。
- pack入力は各動作 `sheet-1.png` からの512×512 RGBA連番。`tools/pack-generated-motions.py` が画素を256×256へ等比縮小し、1行のPNGへ詰める。元の生成画像を描き直さない。PNGは各clip 6MiB以下、メタデータは `shared/content-studio-motion.js` の厳密形式に合わせる。
- `restBounds`は各clipの静止基準コマの透過bbox。着地だけ最終コマ、ほかは先頭コマ。`ground`はbbox底の中央。着地の`contactFrame`は4（5コマ目）で、pack時に接地位置の大きなずれを検出する。実ポーズの接地は最終QCで目視確認が必要。
- 元フレームと原画の内容hash先頭12桁を`assets/content-studio/<slug>/<hash>/`に使い、`character.png`、5動作のPNG/JSONを置く。`content/generated-motion-manifest.json`は既存IDと5動作参照の管理元。公式`tools/content-studio/scripts/generate-game-content.ts`はmanifestを検証して`generated/content-studio-catalog.js`へ重ねる。手動で生成catalogを編集しない。

## 再現と検証

作業repoのルートで採用素材が揃ってから実行する。PythonにはPillowが必要。

```powershell
python tools/pack-generated-motions.py
python tools/pack-generated-motions.py --check
node --test tests/generated-motions.test.js
npm run test:content-motion
```

公式生成と照合は`tools/content-studio`で実行する。lockfile固定の依存は`npm ci --no-audit --no-fund`で導入済み。

```powershell
npm run generate:catalog -- --repo-root=../..
npm run generate:catalog -- --check --repo-root=../..
npm run typecheck
npm exec -- vitest run tests/integration/generator-script.test.ts tests/integration/artifact-flow.test.ts tests/unit/publish-safety.test.ts
```

実Chromeのsmokeは作業repoルートで実行する。Playwrightは隣の`browser-qa/node_modules/playwright`にある。ローカルHTTPへのChrome接続は正式な実行権限で行う。

```powershell
$env:PLAYWRIGHT_MODULE=(Resolve-Path ../browser-qa/node_modules/playwright).Path
node tests/generated-motions-browser.cjs --all
Remove-Item Env:PLAYWRIGHT_MODULE
```

最終確認:

- 全18体のpack入力との画素一致、メタデータ・容量検証、18体必須のNode検証が合格。ゲーム用198ファイルの合計35,514,710 bytes（約33.9MiB）。256pxの全5動作を4体同時に保持したRGBAは44MiBで、既存64MiBキャッシュ内。
- Chromeで18体×5動作×左右のPNG読込、透明画素以外の描画、コマ進行、反転、ループ/終了を確認。実indexの参照と静止画fallback→動作画像の切替も18体合格。
- 実indexの検査ではメニューのRAF更新がPlayerをresetする競合があったため、テストページに限りRAFを停止して隔離した。ゲーム本体は変更していない。これは実対戦全体の操作試験ではなく、実indexの参照・描画接続の検査。ネット対戦、実機スマホ、公開環境は今回未検証。
- 公式generatorの型確認、catalog関連テスト15件、manifest再生成の追加テスト1件、公式生成と`--check`が合格。pack後に公式生成を実行してカタログの並び順・LFを正規化した。
- 全18体の画像一覧を目視確認。会話内の全18体前進プレビューは401,734 bytes。Chromeでキャラ選択、コマ送り、描画、JSエラーなしを確認。プレビューは96px、ゲーム用は256px、元の整列済み素材は512px。
- 新規75動作の採用版、生成指示、生成シートと各フレームのSHA-256は[制作記録](../records/2026-11-02-generated-motion-provenance.json)。生成は組込みimage_genを使用し、有料外部APIは呼んでいない。forge処理の参照commitは同記録に保存。生成元PNGと512pxフレームは作業場所の親にある`all-character-sprites/`、既存3体は上記試作フォルダーに保存。

forgeによる切り出しは`process --mode sheet --cols 4 --rows 2`（被弾のみ3）、`--background-mode native_alpha --cell-size 512 --fit-scale 0.8 --grid-rounding nearest --strict-qc`。前進/後退/砲撃は`--scale-strategy preserve --align feet`、被弾/着地は`--scale-strategy registered --align center`。欠けが検出されたシートは生成ツールで余白を修正し、QCを緩めず再検査した。生のシートと512pxの中間物はローカル保管、ゲームが使う全素材と採用指示・ハッシュはGitHub管理。

## 保留境界

merge・公開・本番反映は未実施。既存の独立監査と公開承認条件を維持する。元の移行作業checkoutの未保存差分は触らない。スワフロはアイデア・優先タスクの記録のみで、実装対象外。

変更は`assets/content-studio/`、motion manifest、生成catalog、公式generatorのmanifest接続、packスクリプト、回帰検証、制作・作業記録。ゲーム本体、能力、物理、通信、保存には変更なし。GitHub正本: https://github.com/futsalife24-bot/katamon 。

使用モデル: 統合担当 `gpt-6-sol` / medium。主担当のモデル設定は未確認。
