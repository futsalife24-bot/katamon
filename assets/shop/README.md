# CATAMON Workshop Asset Library

ショップおよびLOADOUTで使う9商品の画像正本。ゲーム効果、価格、所持・装備状態は `coop-mvp-foundation.js` の既存authorityを使い、このライブラリは表示だけを担当する。

## ディレクトリ

- `master/items/`: 1254×1254 RGBA PNG。生成・再編集の正本。
- `runtime/items/`: 256×256 lossless WebP。ゲーム画面の正式参照。
- `asset-manifest.json`: 商品IDとmaster/runtimeの対応正本。

## 品質基準

- 1画像1商品、正方形、透明背景。文字、UI枠、CATAMON本体を含めない。
- 64px表示でもシルエットと用途を判別できる。
- 黒鉄・真鍮・宝石色を共通素材とし、用途差は色だけでなく形状で示す。
- 背景チェッカーの焼き込みは禁止。
- master PNGとruntime WebPは必ず同時に更新する。

## 更新手順

1. masterを差し替える。
2. 256×256のlossless WebPを生成する。
3. `asset-manifest.json` と `docs/assets/catalogs/shop-assets.csv` を同期する。
4. `npm run test:shop-assets` と対象E2Eを実行する。

