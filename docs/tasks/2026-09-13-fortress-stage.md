# 第1ボス専用ステージ「灼鉄の包囲工廠」

- 状態: 最新公開版へ統合・ローカル検証完了。未コミット・未公開。
- branch: `feat/fortress-stage-20260913`
- base / HEAD: `ab6e38e16cef336fe7ae6b9d617611fafc171d27`（PR #398のアニメーション公開版）
- BUILD: `v2.0.182-fortress-foundry`
- 既存の未公開作業 `../fortress-stage-20260912` からステージ部分のみを移植。元worktreeは変更していない。

## 変更

- 背景を溶鉱炉・クレーン・配管が並ぶ専用工廠へ変更。素材は既存制作済みのPNG/WebPを再利用。
- 鋼鉄台座は黄色の警戒帯、破壊可能な足場は赤銅色。装甲パネル・V字補強・鋲・炉光を地形キャンバスへ焼き込む。
- 足場位置・当たり判定・ボスAI・通信形式は維持。壊れた地形の装飾も同時に消える。
- ロビーと戦闘上部の名称を統一。背景をPWA Tier 2へ登録し、BUILD/SW/更新履歴をv2.0.182へ更新。
- PR #398の両ボスアニメーション・部位追従・味方行動中の固定を保持。

変更ファイル: `index.html`（背景・地形描画・名称・履歴）、`coop-mvp-room.js`（名称）、`sw.js`（素材登録・版）、`tests/cache-version-test.js`（期待版）、背景素材2点、ブラウザ検査、README・現在地・本記録。

## 検証

- cache-version: 2/2。
- coop-fortress-boss: 42/42。
- coop-room-lobby: 47/47。
- coop-boss-motion: 1082 assertions成功（両ボスの実必殺一斉発射・次準備の固定を含む）。
- regression p1: 477/477。
- undef-scan: 2/2。
- 実Chromium・ローカルHTTP: 両ボスの実ドラッグ発射／次ターン、背景切替、鋼鉄床保護、通常足場破壊、通常背景への復帰。390×844と1440×1000を撮影。pageerror 0。
- `git diff --check`: 成功。

## 証拠と残課題

- [近景](2026-09-12-fortress-stage-evidence/fortress-close.png) / [スマホ幅](2026-09-12-fortress-stage-evidence/siege-fortress-01-mobile.png) / [PC](2026-09-12-fortress-stage-evidence/fortress-desktop.png) / [結果](2026-09-12-fortress-stage-evidence/browser-result.json)。検査スクリプトの既存出力フォルダ名を維持しているが、画像・結果は今回の統合版で再取得した。
- 実行: `node tests/fortress-stage-browser.cjs`（ローカルHTTP 4188。`COOP_BASE_URL`で変更可）。
- 物理スマホ、本番Firebase複数人、merge・公開は未実施。ルートの既存コード・他worktreeは保護。
