# 協力ボス戦 Ready! → Fire!

- 状態: 公開準備中。
- branch: feat/coop-ready-fire-20260912
- base / HEAD: f6894fd68a7b40ca665096b11263e99afd75e641（PR #396公開版）
- BUILD: v2.0.180-coop-ready-fire

## 変更

index.htmlに0.95秒の発射前合図を追加。水色Ready!を0.65秒、金色Fire!を0.30秒表示し、短い拡大と斜め帯で強調する。通常弾はReady→Fire→発射。必殺を含む場合はReady→Fire→キャラのオーラ→必殺カットイン→発射の順とし、入力・物理を止める。全員待機では省略。新しい状態は既存のcoopSalvoStateに格納し、リセットとリプレイ保存の既存処理を使用する。合図中は60fps。通信形式・共通開始時刻・同時物理tickは維持。

sw.jsとcache-version-testの版を一致させ、既存ソロ・ブラウザ検査を演出時間へ対応。ブラウザの静止画だけはテスト注入でReady/Fireを保持し、確認後解除する。本体への検証フック追加はない。

## 検証

- ソロ34項目成功（実必殺の順番をフレーム単位で検証）: Ready/Fire中の未発射、4発同tick、期限、入力固定、消費、決着。
- 4独立プロセス通信: 両ボス各26項目成功。通常・複数必殺、全員待機、HP収束、次巡回。
- 既存回帰テストは両席各477項目成功。
- キャッシュ版2項目、静的識別子2項目、git diff --check成功。
- Chromium 390×844: 実ドラッグ、Ready/Fire表示、4発同時、次巡回、期限、pageerrorなし。
- 実機スマホ・本番通信・公開は未実施。
- 初回ブラウザ撮影は短いFireを撮影待ちが追い越して検査失敗したため、撮影中のみ合図を保持する方式へ修正。最初の第1ボステストは誤ったID指定で起動失敗し、実定義siege-fortress-01で再実行成功。

## 証拠

[Ready](2026-09-12-coop-ready-fire-evidence/ready.png) / [Fire](2026-09-12-coop-ready-fire-evidence/fire.png) / [ブラウザ結果](2026-09-12-coop-ready-fire-evidence/browser-result.json) / [差分](2026-09-12-coop-ready-fire-evidence/implementation.patch)

## 公開前の順番修正

ユーザーの指定に基づき、合図を必殺演出より先に移動。キャラオーラの直前で合図を開始し、合図終了後にゲージ消費とオーラへ進む。必殺カットイン後は再度合図へ戻らず発射する。既存回帰ハーネスは合図の検査後にオーラを進める方式へ対応。実ブラウザのフレーム記録は [必殺順番](2026-09-12-coop-ready-fire-evidence/special-sequence.json) を参照。
