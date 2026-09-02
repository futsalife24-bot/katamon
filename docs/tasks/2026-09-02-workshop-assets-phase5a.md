# Workshop Assets Phase 5A

## 目的

既存ショップ9商品の仮オーブ表示を正式な商品画像へ置き換え、同じ画像をLOADOUTの所持品棚でも再利用する。

## 範囲

- 9商品のmaster PNG / runtime WebP / manifest / 台帳
- ショップカードと購入確認のpresentation
- LOADOUTの購入済み商品アイコン
- 画像実ロードとresponsiveのtargeted test

## 非対象

- 商品価格、ゲーム効果、購入・装備authority、保存schema
- 新商品、返金、消耗品化
- Gear / Battle / ONLINE / Firebase / protocol / wire

## 完了条件

- 9商品が重複のない正式画像を持ち、全runtimeが256px lossless WebP
- 412 / 390 / 320pxでカード・ボタン・画面に横overflowがない
- 購入・装備の既存経路を維持
- Draft PRで外部監査待ち

