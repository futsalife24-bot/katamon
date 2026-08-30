# CATAMON Gear Asset Library

Gear画像は完成済み48枚を持たず、次の3レイヤーを実行時に合成する。

1. 既存の共通スロット外枠（`index.html` の `gearSlotFrameSvg()`）
2. 部位シルエット6種（`master/silhouettes` / `runtime/silhouettes`）
3. セット紋章8種（`master/emblems` / `runtime/emblems`）

共通外枠は1形状だけを正本とし、6位置への適用はCSS回転で行う。部位別の外枠画像や、シルエットへ紋章を焼き込んだ完成画像は作成しない。

## ディレクトリ

- `master/`: 1254×1254 RGBA PNG。生成・再編集の正本。
- `runtime/`: 256×256 lossless WebP。UI組み込み時の読込候補。
- `asset-manifest.json`: 正式slot/set一覧、ファイル対応、紋章ソケット位置。

## 合成

各部位シルエットには空の六角ソケットが描かれている。`asset-manifest.json` の `socket` は、シルエット画像に対して紋章の中心を配置する割合座標と、紋章幅の目安を示す。

座標は初期アートQA用。production UIへ接続するPRでは、実際のCSS画像サイズで再度位置を確認すること。

## 禁止事項

- 6部位×8セットの完成画像48枚を追加しない。
- 部位ごとに異なる外枠を追加しない。
- Gear画像へ文字、UI、背景、CATAMON本体を含めない。
- 色だけで部位またはセットを識別させない。
- master PNGだけ、またはruntime WebPだけを片側更新しない。

## 視認性基準

- 部位シルエット: 100 / 74 / 64 / 48pxで役割を判別できる。
- セット紋章: 64 / 48 / 27pxで輪郭差が残る。
- alpha背景: 実透明。チェッカー模様の焼き込みは禁止。
