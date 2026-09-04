# BATTLEステージアイテム実装

更新日: 2026-09-04

## 目的

通常のオフラインCPU BATTLEへ、戦況を動かすステージアイテムとGear素材の追加獲得ルートを入れる。

## 初回公開の範囲

- 対象は通常CPU 1vs1・公式ステージ・10連勝ボス以外。
- ONLINE、2vs2、協力戦、演習、チュートリアル、デモ、カスタムステージは変更しない。
- 両者が1回ずつ行動した`turnCount = 2`から出現可能。同時1個、寿命6手番、取得・消滅後4手番、1試合最大3個、`turnCount >= 20`では新規出現しない。
- 種類は回復45%・必殺チャージ30%・Gear資源箱25%。1試合上限は回復2、チャージ1、資源箱1。
- 通常砲弾の通過、歩行接触、跳躍の着地点で取得する。レーザー・必殺弾・直進固定弾は取得判定へ使わない。
- CPUも同じ条件で取得できる。初回はCPUの移動AIへアイテム追跡を追加せず、既存行動中の接触だけを扱う。

## 効果とバランス

- 回復: 最大HPの20%を端数切上げ。最大HPを超えず、HP 0の復活やGear回復倍率は使わない。満タン時は消費しない。
- 必殺チャージ: 1段階。4/4を超えず、満タン時は消費しない。
- Gear資源箱: 現在2連勝以上で抽選対象。プレイヤー取得時は粉末3、独立5%で設計片1。CPU取得時は奪われて消滅する。
- 資源箱は1連勝runで最大10箱、設計片は最大1個。種類・位置・設計片判定は`runId + matchOrdinal + spawnOrdinal`から決定し、`Math.random()`の対戦列を消費しない。
- プレイヤーが拾った資源はCPU runのエスクローへ即時記録し、勝敗にかかわらずrun終了時の既存精算1件へ合算する。箱ごとの未受取報酬は作らない。

## 保存と互換性

- CPU run保存をv2へ上げ、`stageItemEscrow`に累計素材と現試合の取得maskを保持する。v1は素材0として読み込み、旧pending intentは内容を変えない。
- CPU settlement rulesをv3へ上げ、既存の連勝報酬とステージ素材を安全整数で合算する。v1/v2 intentの再開結果は不変にする。
- 試合内の出現状態はCPUローカル中断snapshotだけへ保存し、ONLINE snapshot/wireへ載せない。旧snapshotはアイテムなしとして再開する。
- 同じ資源箱の再取得、リロード、複数タブ、精算再試行でも加算は一度だけとする。
- 資源箱の保存に失敗した場合は同じitem identityと効果を保持し、継続・精算・中断の先頭で再試行する。保存できるまで素材0の終端精算へ進めない。

## アートと公開

- 3種とも1254px RGBA PNGをmaster、256px lossless WebPをruntimeとする。
- Canvasではruntimeを遅延読込し、読込失敗時も図形fallbackを描く。
- runtime WebP失敗時は大型master PNGを通信fallbackに使わず、即座にCanvas図形fallbackへ切り替える。
- runtime 3点だけをPWA Tier 2へ追加する。
- BUILDは`v2.0.171-stage-battle-items`。GitHub Actions成功後にmasterへmergeし、Pages自動公開を確認する。

## 完成条件

- pure module、保存移行、精算、Canvas統合、asset/PWAの自動テストが成功する。
- 通常砲弾・歩行・跳躍着地の取得、効果上限、対象外モード、snapshot復元、二重付与防止を確認する。
- 生成画像の透明度・寸法・lossless WebPと、Canvas fallbackを確認する。
- Firebase Rules/Console、ONLINE wire、実機GOAL QAは変更・実施しない。
