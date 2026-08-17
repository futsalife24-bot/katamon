# カタモン縦型PV 制作完了レポート

制作日: 2026-08-02（JST）

## 完成物

- プレビュー: `output/preview/catamon_vertical_pv_preview.mp4`
- 最終版: `output/final/catamon_vertical_pv_final.mp4`
- サムネイル: `output/final/catamon_vertical_pv_thumbnail.png`
- 設定: `config/pv_config.yaml`
- 再生成: `scripts/build_preview.js` / `scripts/build_final.js`

## 最終版の実測

- 尺: 56.000秒
- 解像度: 1080×1920
- fps: 30
- 映像: H.264 / yuv420p
- 音声: AAC
- ファイル容量: 約18.6MiB
- 平均音量: -14.9dB
- 最大ピーク: -1.3dB
- 黒画面: 検出なし
- 0.4秒以上の無音: 検出なし

## 使用方針

- 既存のカタモン背景、キャラクター、ロゴ、BGMだけを使用。
- 外部素材は取得していない。
- キャラクターの縦横比、向き、色、輪郭を維持。
- Noto Sans JPを使用し、縦画面セーフエリアへ短い日本語テロップを配置。
- 公式SNS名とゲームURLは未提供のため描画していない。設定には差し替え用プレースホルダーを保持。

## 不足素材と今回の扱い

- 実プレイ録画が無いため、砲撃場面は実装済み要素を正規素材で抽象化した「演出再構成」。ゲーム録画とは表現しない。
- 正式効果音が無いため、FFmpegで作った仮の発射・着弾・UI・勝利音を使用。
- ブラウザ安全ポリシーによりローカル`file://`のゲーム画面取得は拒否された。ポリシー回避は行わず、正規素材だけで制作した。

## 再利用

`input/`へ新素材を別名追加し、`config/pv_config.yaml`の参照先を変更してプレビューから再生成する。ゲームプレイMP4を各シーンの`background`へ指定すると、自動縦型クロップが使える。注視位置は`focus_x` / `focus_y`で調整する。
