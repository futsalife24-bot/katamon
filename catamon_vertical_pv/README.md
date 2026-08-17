# カタモン 縦型PV 自動制作環境

既存のカタモン素材から、TikTok / YouTube Shorts / Instagram Reels向けの9:16動画をFFmpegで自動生成する環境です。入力素材は読み取り専用として扱い、生成物は`temp/`と`output/`だけへ書き出します。

現在の完成版は、実プレイ録画が未提供のため「正規背景・キャラクター・ロゴによる演出再構成版」です。発射・弾道・着弾は実装済み砲撃要素の抽象演出で、ゲーム画面録画そのものではありません。

## すぐ使う

PowerShellでこのフォルダへ移動し、次を実行します。

```powershell
npm run scan
npm run analyze:music
npm run preview
npm run final
```

個別コマンドでも実行できます。

```powershell
node scripts/build_preview.js
node scripts/build_final.js
node scripts/qa_video.js final
```

Pythonは不要です。Node.jsとFFmpegを使います。

## 必要環境

- Windows 10 / 11
- Node.js 20以降
- FFmpeg / FFprobe（Gyan.FFmpeg推奨）
- `C:/Windows/Fonts/NotoSansJP-VF.ttf`

FFmpegが無い場合の例：

```powershell
winget install --id Gyan.FFmpeg -e
```

FFmpegがPATHに無くても、WinGet標準フォルダ内をスクリプトが自動探索します。任意の実体を使う場合は`FFMPEG_PATH`と`FFPROBE_PATH`を設定できます。

## 主な成果物

- `output/preview/catamon_vertical_pv_preview.mp4` — 540×960の高速確認版
- `output/final/catamon_vertical_pv_final.mp4` — 1080×1920の投稿用高品質版
- `output/final/catamon_vertical_pv_thumbnail.png` — 1080×1920サムネイル
- `reports/storyboard.md` — 56秒の絵コンテ
- `reports/asset_inventory.csv` / `.json` — 素材一覧と技術情報
- `reports/used_assets_timeline.csv` — 使用素材と使用時間
- `reports/missing_materials.md` — 不足素材と代替処理
- `reports/bgm_analysis.json` — BGM音量変化の解析
- `reports/bgm_structure_analysis.json` — BPM・強拍・盛り上がり・推奨56秒区間の解析
- `reports/qa_report_preview.md` / `qa_report_final.md` — 自動検査結果
- `temp/*_qa_contact_sheet.png` — 7秒間隔の目視検査シート
- `temp/*_scene_contact_sheet.png` — 全シーン中央フレームの精密検査シート
- `logs/build.log` — エラー調査用ログ

## 設定変更

正本は`config/pv_config.yaml`です。JSONはYAML 1.2の有効な記法なので、依存ライブラリなしで扱えるJSON互換YAMLとして保存しています。

変更できる主な項目：

- タイトル、尺、解像度、fps
- BGM、開始位置、音量、目標ラウドネス
- シーン開始時間、尺、背景、キャラクター、優先度
- テロップ、色、表示位置、表示時間
- カット / フラッシュカット
- 発射・着弾・UI・勝利の効果音タイミング
- ロゴ、CTA、公式SNS名、ゲームURL
- プレビュー / 最終版のCRF、preset、音声ビットレート

シーンの`start`は前シーン終了時刻と一致させ、全シーンの合計を`project.duration_seconds`と一致させてください。ビルド前に自動検査されます。

## 素材を差し替える

1. 元ファイルを残したまま、別名で該当フォルダへ追加します。
2. `pv_config.yaml`内のファイルパスを変更します。
3. `npm run preview`で確認します。
4. 問題がなければ`npm run final`を実行します。

入力先：

- ゲームプレイ録画: `input/gameplay/`
- キャラクター: `input/characters/`
- ロゴ: `input/logo/`
- BGM: `input/music/`
- 正式効果音: `input/sound_effects/`
- UI素材: `input/ui/`
- 背景: `input/backgrounds/`

MP4などのゲームプレイ録画をシーンの`background`へ指定すると、縦画面を埋めるように自動スケール・クロップします。`focus_x`と`focus_y`（0.0〜1.0）で重要部分をクロップ中心へ寄せられます。現版は素材解析だけで人物を追跡するAIクロップではなく、安全な設定駆動の注視点クロップです。

## 音声

BGMは設定した開始位置から56秒を使用し、発射・着弾・UI・勝利音を拍の山場へ配置します。`npm run analyze:music`で曲全体の推定BPM、強い瞬間、音量上昇点、PV向け推奨区間を再解析できます。最終段でラウドネス正規化、リミッター、AAC化を行います。

現版は「撃ち抜けカタモン.mp3」の49.8〜105.8秒を採用し、推定約79BPMの強拍へ全15シーンと効果音を整列しています。

正式効果音が未提供のため、現版の効果音はFFmpegで合成した仮音です。外部素材は取得していません。正式音源へ差し替える際は`temp/generated_sfx/`ではなく`input/sound_effects/`へ置き、スクリプトの音源参照を変更してください。

## 自動検査

ビルド後に次を検査します。

- 尺、解像度、fps
- H.264 / AAC / yuv420p
- 黒画面区間
- 0.4秒以上の無音
- 最大音量
- 7秒間隔のコンタクトシート
- 全15シーンの中央フレーム精密シート

画面の意味、テロップと攻撃演出の重なり、キャラクターの印象は完全自動判定できないため、コンタクトシートも確認してください。

## 現在の不足情報

- 実プレイ録画
- 正式効果音
- 公式SNS名
- ゲームURL

未提供のSNS名・URLは`__SET_OFFICIAL_SNS__` / `__SET_GAME_URL__`として設定へ残し、動画には表示していません。
