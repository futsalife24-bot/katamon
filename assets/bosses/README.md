# 協力ボス素材

初代協力ボス「超大型要塞戦車」の正本と実行用素材です。

- `master/fortress-tank.png`: Phase1。ミサイルポッド閉鎖
- `master/fortress-tank-phase2.png`: Phase2。ミサイルポッド展開
- `runtime/*.webp`: 上記正本を幅1024px・WebP quality 92で軽量化したゲーム読込用

## 制作記録

- 制作日: 2026-08-22
- 制作方法: Codex組み込み画像生成（新規生成後、背景透過とPhase1ポッド閉鎖を編集）
- 外部素材: なし
- 主要指定: カタモンの石壁・黒鉄・真鍮・古びた機械意匠、左向きの固定要塞、主砲・連装砲・前面装甲・ミサイルポッドをモバイル表示でも判別可能にする
- 禁止指定: 文字、ロゴ、透かし、近未来的な光沢、現代戦車、背景、人物

部位の正確な当たり判定と表示位置は、画像の画素ではなく `coop-mvp-boss.js` の正規化座標を正本とします。

## SHA-256

- `fortress-tank.png`: `53b60ea3786bac9e8e8ce59a87e0fc6a6c26da33adc6aa92ee62fbb4d86d4620`
- `fortress-tank-phase2.png`: `265daeb673cbcd8c7f0b0544ebbe6e38370fc6907b8b26f89ee9412db38efcca`
- `fortress-tank.webp`: `b9f3dd8d3842f85c90849673d1903b605d8643092423c0ce459df47dcc1424eb`
- `fortress-tank-phase2.webp`: `5b594a85042dec2b1a09cbcb8a0c52d5c7b28629f1dfa3cebf9df91bebddb542`
