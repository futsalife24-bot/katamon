# 固定メイン較正（2026-08-25）

## 目的

Phase 1の純粋ギアドメインで、砲身・装甲・コアを本番用の確定テーブルだけで生成・強化・保存できるようにする。ゲーム本体、報酬接続、戦闘計算、UIは対象外。

## 承認済み数値

砲身・装甲・コアの`+12`完成値は共通で、★1〜★6に対し`[4, 5, 7, 9, 10, 12]`。

- `+0`は25%切り捨ての`[1, 1, 1, 2, 2, 3]`
- 以後のメイン値は整数のまま単調非減少、`+12`で完成値へ一致
- `Normalized 100`はギア側のAttack/Defense互換参照であり、戦闘の基礎Attack/Defenseや最終式を規定しない
- schema / generation / enhancement / balanceの各バージョンはすべて`1`、gear storage schemaは`2`のまま

## 較正根拠と保留事項

現行通常カタモン18体のHP監査値は次のとおり。

| キャラクターID | HP |
|---|---:|
| kyoryu | 100 |
| medama | 90 |
| iwa | 130 |
| tori | 75 |
| barugerukan | 82 |
| nisenmono | 140 |
| burumutan | 110 |
| sumoeru | 100 |
| doRednote | 95 |
| hamulton | 92 |
| mocchario | 110 |
| mecha | 98 |
| akuma | 84 |
| jinba | 108 |
| kishi | 132 |
| neko | 80 |
| shinigami | 92 |
| coolKai | 66 |

18体の統計は、最小66、Q1=84、中央値96.5、Q3=110、最大140、平均99.11、両端除外平均98.625。装甲★6・+12の`HP+12`は平均比約12.1%、中央値比約12.4%で、既存の「標準的な対応基礎値に概ね10〜15%」方針と整合する。

### 現行Attack / Defenseの接続監査

- プレイヤーキャラクター共通の実戦Attack statは存在しない。通常弾45は代表的な基礎ダメージであり、必殺・多段・固定・DoTなど全攻撃の共通baseではない。
- プレイヤーキャラクター共通の実戦Defense stat / 共通Defense式は存在しない。現行の`damageTakenMul`やbarrierは、将来のDefense bucketとは分離して扱う必要がある。
- `selectStats.attack` / `selectStats.defense`は選択画面向け表示値であり、現行の実戦damage計算へ接続された基礎値ではない。
- Attack / Defenseの100は現行値の置換ではなく、Gear数値を比較・評価するための互換基準とする。Gearなしの戦闘結果はPhase 3でも完全維持する。

### Calibration候補

3部位とも同じ★別+12完成値を使う前提で、可変mainより★差を抑えた3案を比較した。

| 案 | ★1 | ★2 | ★3 | ★4 | ★5 | ★6 | 評価 |
|---|---:|---:|---:|---:|---:|---:|---|
| Conservative | 4 | 5 | 6 | 7 | 9 | 10 | 常設3mainの影響を抑えやすいが、高★到達時の手応えが弱い |
| Balanced（採用） | 4 | 5 | 7 | 9 | 10 | 12 | 標準値100に対して★6+12が12%相当で、正本の約10〜15%方針と一致 |
| Aggressive | 4 | 6 | 9 | 11 | 13 | 15 | 高★の差は明瞭だが、可変3枠と組み合わせた際の過剰成長リスクが高い |

Balancedは現行HP分布の中心値がおおむね100であること、Normalized 100との対応が読みやすいこと、固定3部位の★差を可変3部位より小さく保てることから採用した。最大のbalance riskは固定3部位単体ではなく、可変3枠へ割合mainや強力なサブOPを重ねた完成buildである。Phase 3では現実的な★5〜6 / Epic〜Legendary / +9〜12の代表buildで20〜30%目標を実測する。

これはギアの保存値とGS分母を確定する作業である。最終Attack/Defense式、ダメージ/軽減への適用順、丸め規則、可変メイン・サブ・セットを重ねた実戦差はPhase 3で決めて検証する。とくに可変3部位の割合メインを重ねた時の累積影響は、固定値表だけでは判定しない。

今回までproductionの固定mainは`null`で生成不能、正規Gear報酬も本番未接続であり、配布済みproduction Gearの再解釈は発生しない。未完成だったv1 tuningの正式確定なので、Gear schema / generation / enhancement / balance tuningの各versionは`1`のまま維持する。今後Gear配布開始後に値を変更する場合は`BALANCE_TUNING_VERSION`を上げる。

## 完成条件

- 本番tuningのみで全固定部位・全★を生成できる
- 全6部位・全★・全レベルで単位、端点、単調性、`floor(start + (final-start) × level / 12)`を確認する
- 固定各部位で直接+12、段階強化、JSON復元が同一結果になる
- GSはメイン点を有理数で合算し、★6+12のメイン点が20になる
- 最大到達GSはenhancementSeedに依存しない
- storage schema v2の往復で固定部位を保存・検証できる

## 保存の持ち越し

複数キーをまたぐ確定操作は既存WAL方式を使う。起動時に残留WALを検出したら、取引IDを保った前方復旧と読戻し確認を行い、成功後だけWALを削除する。曖昧・競合・失敗時はWALを残し、通常書込みを止める。固定メイン較正はこの復旧契約を変更しない。

## Balance versionの持ち越し

現時点で登録済みのproduction tuningはv1だけなので、異なる`balanceTuningVersion`を同時装備する正規ロードアウトは成立しない。将来v2を登録する前に、`aggregateLoadout`が各Gearの保存versionから個別tuningを解決するよう拡張し、v1/v2混在ロードアウトの回帰テストを必須とする。v2導入前に未対応ならP1として扱い、単一の最新tuningで旧Gearを再解釈してはならない。
