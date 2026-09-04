# CATAMON Battle Item Asset Library

ステージ上の戦闘アイテム3種を表示するための画像ライブラリ。生成画像をアートの元データとし、透明背景のmaster PNGと軽量なruntime WebPへ整形している。

このライブラリは表示だけを担当する。回復量、必殺チャージ量、Gear素材の付与量と取得判定は、ゲーム本体の既存authorityを正本とする。

## 収録アイテム

| ID | 用途 | 役割 |
|---|---|---|
| `healing` | 回復アイテム | 戦闘中のHP回復を表す |
| `special_charge` | 必殺チャージ | 必殺ゲージ増加を表す |
| `gear_resource` | Gear素材 | Gear粉末と設計片の取得を表す |

## ディレクトリと仕様

- `master/items/`: 1254×1254、8-bit RGBA PNG。再編集・再生成の正本。実行時には読み込まない。
- `runtime/items/`: 256×256、lossless VP8L WebP。Canvas表示とPWAキャッシュの正式参照。
- `asset-manifest.json`: ID、用途、master/runtimeの対応、寸法、形式の正本。順序は `healing` → `special_charge` → `gear_resource` で固定する。

全画像は実透明背景を持ち、背景チェッカー、文字、UI枠、CATAMON本体を焼き込まない。

## Canvas表示とフォールバック

Canvasはmanifestのruntime WebPを読み、アスペクト比1:1のまま表示枠内に収まるよう `drawImage()` で中央配置する。画像の透明度はCanvas側で塗り潰さず、地形やエフェクトが背景に見える状態を保つ。master PNGをCanvasの実行時フォールバックに使わない。

WebPの未読込みまたは読込失敗時は、既存のCanvasプリミティブによる簡易アイコンを表示する。フォールバック中も当たり判定と取得効果は画像読込状態から切り離し、戦闘を続行できるようにする。

runtime 3枚はService Workerの `TIER2_ASSETS` でタイトル待機中に取得する。`APP_SHELL`、T0 preload、ページ側の初回描画キャッシュには含めない。

## 更新ルール

1. 対応するmaster PNGとruntime WebPを同時に更新する。片側だけの差し替えは禁止する。
2. ID、ファイル名、形式を変えた場合は `asset-manifest.json` と `sw.js` を同期する。
3. 素材変更を配布する場合はBUILD/CACHE版を更新する。大型素材の永続キャッシュ名 `katamon-assets-v1` は変えない。
4. `node tests/battle-item-assets.test.js` で寸法、RGBA透明度、VP8L、対応漏れ、孤立ファイル、T2登録を確認する。
