# ギアシステム Phase 0 監査・段階実装計画

- 作成日: 2026-08-25
- 対象仕様: [`docs/gear-system-v1.md`](../gear-system-v1.md)
- 取得元: `CATAMON_GEAR_SYSTEM_SPEC_v1.0.md`（Google Drive）
- 対象master: `3812d682b94386d1677d025b9e3a4f34d79fff18`
- 調査worktree: `coop-boss-mvp-v2`
- 調査ブランチ/HEAD: `codex/fix/coop-normal-core-two` / `8b40a0dbec22f3be5d0a420c2712e6b425296d91`
- 差分確認: 調査開始時点で `HEAD` と `origin/master` のファイル内容差分なし
- スコープ: 調査、正本化、接続点・衝突・PR分割の確定のみ。ゲーム挙動、公開物、バージョンは変更しない。

## 1. 結論

ギアシステムは既存の対戦エンジンを保ったまま段階導入できる。Phase 1は純粋ドメインとして先行でき、現行に存在しない基礎攻撃・基礎防御の互換定義、攻撃効果の分類、PvP装備の正当性は、戦闘接続を始めるPhase 3で決定する。

固定3部位（砲身の固定攻撃、装甲の固定HP、コアの固定防御）の本番値はPhase 0時点では未確定であり、Phase 1では注入されない限り生成・GS計算を明示エラーで停止するfail closedとした。その後、[固定メイン較正](2026-08-25-gear-fixed-main-calibration.md)でNormalized 100と★別完成値`[4, 5, 7, 9, 10, 12]`を正式承認し、この依存は解決済みである。

特に、被ダメージ処理は一部だけを改修すると必殺技やDoTがすり抜ける。Phase 3では、既存の数値を変えずに各経路を型付きの戦闘効果パケットへ集約し、ギア無効時に現行結果と完全一致することを先に固定する。

保存容量は、500ギア、一時BOX 50、未受取10件を合わせても、今回の仮スキーマでは概ね0.3〜0.9 MiBの範囲に収まる見込みである。容量そのものより、`localStorage`の同期書き込み、容量超過時の握り潰し、複数キー更新中の中断が主要リスクとなる。

## 2. 読んだ正本・関連文書

1. `AGENTS.md`
2. `CURRENT_WORK_STATE.md`
3. `README.md`
4. `docs/gear-system-v1.md`（Drive添付をそのまま保存した設計正本）
5. `docs/tasks/2026-08-22-coop-boss-mvp.md`
6. `docs/coop-boss-mvp-mobile-qa.md`
7. `docs/CHANGELOG.md`
8. `tests/README.md`

`CURRENT_WORK_STATE.md`の現行値とコードを照合し、タイトルのBATTLE/GARAGE 2ページ構成、協力ボスNORMALの基礎HP 1650・12巡を確認した。これらはギア実装の変更対象にしない。

## 3. 現行コードの接続点

### 3.1 キャラクター基礎値

| 項目 | 現在の接続点 | 監査結果 |
|---|---|---|
| キャラ定義 | `index.html:3204` `LEGACY_CHARACTERS` | 実戦値は主に`maxHp`、`blastMul`、`fuelMul`、一部`damageTakenMul`。`selectStats`は表示用。 |
| HP・燃料反映 | `index.html:4261` `applyCharacter` | HPは`def.maxHp`、燃料は共通`FUEL_MAX`へ`fuelMul`を乗算。 |
| 攻撃 | `index.html:13425` `computeDamage` | 通常弾は固定45を基礎に距離減衰。キャラ別の基礎攻撃値は存在しない。 |
| 防御 | `index.html:4290` `mitigateDamageWithSubweaponBarrier`、`index.html:13508` `explodeAt` | キャラ別の基礎防御値・共通防御式は存在しない。実態は`damageTakenMul`と一発バリア。 |
| 爆風 | `index.html:13425`、`index.html:13508` | `blastMul`は主に爆風半径へ作用し、中心ダメージを上げる「爆風威力」と同義ではない。 |
| ノックバック | `index.html:13495`付近 `applyExplosionKnockback` | 通常弾は原則0。対応必殺・サブウェポンだけが速度を渡す。威力・耐性の共通ステータスはない。 |

全18キャラの現行HPは66〜140、中央値は約96.5。燃料は共通102へ`fuelMul` 0.72〜1.35を適用している。固定HPはこの分布から逆算できるが、固定攻撃・固定防御は互換基準の新設が必要である。

### 3.2 ダメージ・回復・状態異常の経路

主な発射入口は`index.html:5277` `launchShot`、共通爆発は`index.html:13508` `explodeAt`、共通ユニットダメージ候補は`index.html:5886` `applyResolvedUnitDamage`である。

ただし全処理が共通入口を通るわけではない。

| 種別 | 現行経路・代表位置 | ギア導入時の扱い |
|---|---|---|
| 通常弾・一般爆風 | `computeDamage` → `explodeAt` → `applyResolvedUnitDamage` | 攻撃、会心、直撃、爆風、軽減、シールドの基準経路にする。 |
| 花火破片 | `index.html:4814`付近 | HPを独自更新しており、共通パイプラインへ接続が必要。 |
| レール・雷・プリズム等 | `index.html:5089`、`6036`、`6061`付近 | 既に`applyResolvedUnitDamage`を通るものもあるが、攻撃アクションIDを付与する。 |
| EMP | `index.html:13432`付近 | 独自ダメージと状態異常。状態異常耐性の共通入口が必要。 |
| 地面炎DoT | `index.html:5946`付近 | 独自HP更新。DoTは会心対象外として明示分類する。 |
| 自傷・DEAD LINE | `index.html:5434`、`14387`、`14447`付近 | 敵攻撃ではないため背水を誤発動させない。 |
| 自己回復・救助・吸収 | `index.html:5139`、`5239`、`5256`、`13565`付近 | 実回復量を返す共通Heal処理へ接続し、救援の空回復を除外する。 |
| シールド | `subweaponBarrierActive` | 現状は一撃無効系のみ。数値シールド残量は新規状態として必要。 |

砲弾本体の直接接触は、衝突時に`directTargetId`が記録され、`explodeAt`で対象を比較している。この既存判定を、会心対象の直撃および強襲4セットの基礎判定として再利用できる。

### 3.3 協力ボス

| 項目 | 接続点 | 現行値・注意 |
|---|---|---|
| 基礎HP | `coop-mvp-battle.js:35` | NORMAL 1650、HARD 2400、EXTREME 2600。変更しない。 |
| 巡制限 | `coop-mvp-foundation.js:23` | NORMAL 12、HARD 15、EXTREME 12。変更しない。 |
| 部位耐久 | `coop-mvp-boss.js:41`、`:218` | 本体最大HP×0.06×部位係数。 |
| 本体・部位spill | `coop-mvp-boss.js:39-40`、`:285` | hull 2/3、部位から本体へ0.4。 |
| CORE倍率 | `coop-mvp-boss-ai.js:11-13` | NORMAL 2、HARD 1.75、EXTREME 1.5。 |
| 現行ブラウザ統合結果 | `coop-mvp-battle.js:735` `enterResult` | `foundation.loadState()`→`session.createRuntime()`→`session.resultSummary()`→`session.rewardEvent()`→`rewards.recordEvent()`→`foundation.saveState()`を実施。既存コイン・初回クリアは統合結果経路で処理される。 |
| room状態反映 | `coop-mvp-battle.js:1533`以降 | `onResult`はREADY解除とroom phase更新が中心。報酬確定は上記`enterResult`経路を確認済み。 |

ギア報酬は、確認済みの`enterResult`結果経路を起点に、Phase 2で保存・transaction・`rewardId`の冪等基盤を整えた後に接続する。証拠なしに結果コーディネータの新設や既存結果処理の統一リファクタリングを前提にしない。

協力ルームには`room.round.id`があり、試合世代も管理されている。候補は`coop:{roundId}:{generation}:{uid}`。同じ部屋の各プレイヤーへ同一抽選結果を配るか、プレイヤー別Seedにするかは承認事項とする。

### 3.4 CPU BATTLE

| 項目 | 接続点 | 注意 |
|---|---|---|
| 中断キー | `index.html:7250` | `katamon_suspend_v1`。スナップショットversion 4。 |
| 保存 | `index.html:7446` `saveSuspendedMatch` | ターン境界で自動保存。`winStreak`、`runStats`、ボス戦状態を保持。 |
| 再開 | `index.html:7746` `resumeSuspendedMatch` | 現行互換を維持する。 |
| 敗北リセット | `index.html:7467`付近、`:13691` `applyStreakResult` | 敗北時に中断を削除し、連勝と効率を確定後リセット。 |
| 結果画面 | `index.html:17130` `drawResultBanner`、`:20500`付近入力 | 継続・タイトル導線。精算UIは未実装。 |
| 新試合 | `index.html:20896` `resetMatch` | 10連勝ボス、必殺ゲージ引継ぎなど既存仕様あり。 |

CPU報酬には、Date.now依存でない永続`runId`と精算回数が必要。精算を押した瞬間に「完成ギア＋rewardId」を作成して未受取へ保存し、その保存成功後に連勝状態を終了する。敗北時の品質降格も同じ純粋関数へ入れる。

### 3.5 オンライン同期・検証

| 項目 | 接続点 | 現状 |
|---|---|---|
| ユニット直列化 | `index.html:7286` `serializeUnit` | HP/maxHP、燃料、位置、状態等。装備・派生戦闘値はなし。 |
| スナップショット | `index.html:7315` `buildSnapshot` | 試合状態を送る。 |
| 範囲検証 | `index.html:8186` `hasSafeUnitSnapshot` | maxHPは1〜200。HP装備導入後は単純な上限拡大ではなく、正規装備から再計算した期待値と照合すべき。 |
| パケット検証 | `index.html:8351` `validateFirebaseMessageDetail` | fire/state/result等の形を検証。fireは軌道と行動指定で最終ダメージを送らない。 |
| 状態整合 | `index.html:8719` `stateSnapshotMismatchReason` | maxHP等は比較する一方、行動側権威の都合でHP・燃料の完全比較はしない。既存の限界としてコメント済み。 |
| 発射同期 | `index.html:9493` `netSendFire` | actionIdを作り、軌道・必殺・跳躍・サブウェポンを送る。 |

装備導入後も「最終攻撃力+123%」のような派生値を相手から信用しない。開始時に選択6ギアの正規データ、ルールversion、loadout hashを交換し、両端末が同じ純粋関数で派生値を再計算する。装備は試合開始時に固定し、ターン中の変更を受け付けない。

ただしローカル保存だけでは、攻撃者が「形式上は合法な神ギア」を自作したかどうかを相手端末が証明できない。完全な改ざん対策には、サーバー側の所持品正本、署名済み報酬、または対人だけギア無効・規格化のいずれかが必要である。これはPhase 3実装前の承認事項とする。

### 3.6 カタコイン・ショップ・実績・保存

| 項目 | 接続点 | 監査結果 |
|---|---|---|
| 共通進捗保存 | `coop-mvp-foundation.js:8-9` | `katamon_coop_mvp_v1`、schemaVersion 1。 |
| 正規化 | `coop-mvp-foundation.js:80-150`付近 | 既知フィールドを作り直す方式で、未知フィールドは保持しない。 |
| 保存 | `coop-mvp-foundation.js:163` | 例外を捕捉して失敗を呼び出し元へ返さない。報酬トランザクションには不十分。 |
| コイン | `coop-mvp-foundation.js:196` `grantCoins` | reward ledgerと上限超過pendingを持ち、冪等性の土台がある。 |
| 協力報酬・実績 | `coop-mvp-rewards.js:101` `recordEvent` | PvP、通常テクニック、協力結果のイベントを処理。 |
| ショップ | `coop-mvp-shop.js` | foundationのwallet/inventory/equipmentを使用。 |
| キャラ解放 | `index.html:9790`付近 | `katamon_character_unlock_v1`として別保存。 |
| CPU中断 | `katamon_suspend_v1` / `katamon_custom_suspend_v1` | カスタムステージを含み、ギア以外で比較的大きくなり得る。 |

ギア本体は`katamon_gear_v1`へ分離する。既存foundationの正規化でギアを落とす事故を避け、機能フラグOFF時・ロールバック時にも旧クライアントが無視できるためである。

コインとギアの同時更新はキーを跨ぐため、そのままでは原子的にならない。次の小さなジャーナル方式を採用候補とする。

1. `katamon_gear_txn_v1`へ取引ID、変更前hash、変更後データまたは再実行可能な命令を保存
2. ギア保存とfoundation保存を実施
3. 両方を読み戻して検証
4. 成功後にジャーナルを削除
5. 起動時に残留ジャーナルを同じ取引IDで再実行または完了判定

保存失敗を握り潰さず、受取・強化・分解・制作の確定前にUIへ失敗を返す必要がある。

### 3.7 GARAGE MENU

正しい追加点は`index.html:6248` `TITLE_MENU_PAGES`の`garage.items`。現在はショップ、実績、サウンドテストで、コメントもギア追加位置を明示している。遷移は`index.html:20129`付近の既存itemIdハンドラへ追加する。

BATTLE/GARAGEのスライダー、320msアニメ、スワイプ判定、既存3項目の遷移は作り直さない。PR 4でギア項目を追加するだけにする。

### 3.8 テストハーネス

- `npm test`が全体回帰の正本。
- `tests/*.test.js`に純粋Nodeテストがあり、協力ボスの各モジュールも直接テストできる。
- `tests/seatharness.js`は外部スクリプトと`index.html`のインラインコードを読み込み、テスト用フックを注入する。実装側へテスト専用APIを露出させない。
- オンラインは固定PRNGを使うループバックテストがあり、装備hash、会心Seed、複数弾の決定性を追加できる。
- Android縦画面E2EはUIを追加するPR 4で必須。PR 1〜3はロジック・通信の自動テストを先行する。

## 4. 保存容量見積もり

実スキーマ確定前の保守的な概算である。1ギアを、表示名・全抽選結果・Seed等を毎件展開した冗長JSONと、ID・Seed・差分値中心のコンパクトJSONの2種類で試算した。

| 仮定 | 1ギア | 500倉庫＋50BOX＋未受取10件×1 | 未受取10件×5 | UTF-16上限目安 |
|---|---:|---:|---:|---:|
| 冗長JSON | 約729 bytes | 約413 KB | 約443 KB | 約0.83〜0.89 MB |
| コンパクトJSON | 約238 bytes | 約139 KB | 約149 KB | 約0.28〜0.30 MB |

結論:

- ギア単体は1 MiB未満に収まる見込みで、一般的な`localStorage`容量内では現実的。
- ただし同一originにはCPU中断、カスタムステージ、音声設定、戦績等も同居する。
- `localStorage`は同期APIなので、フレームごとに全倉庫を再直列化しない。明示的な装備・受取・強化等の操作時だけ保存する。
- PR 2で500/50/10の最大データを実生成し、文字数、保存時間、読込時間、容量超過例外をPCとAndroid実機で測る。
- 将来、履歴や大量ログまで持つ場合はIndexedDB移行を別判断にする。Phase 1で先回りして移行しない。

## 5. 性能累積の監査

### 5.1 正本上の20〜30%目標

「20〜30%」は、無装備に対して、現実的に到達する★5〜6・Epic〜Legendary・+9〜+12程度の整理されたビルドが示す標準的な実戦差を指す。★6 Mythicの理論最大・神個体がこの範囲を超えること自体は許容される。

可変3部位を★6攻撃メインにし、★6サブとセット効果を最大化した理論ケースは、仕様値の異常検知に使う。これは標準ビルドの実戦差を直接表すものではなく、Phase 1で数値表を弱体化・強化する根拠にはしない。

### 5.2 検証フェーズ

代表ビルドの通常弾・必殺・生存・燃料を含む実戦シミュレーションと、20〜30%目標の実測は、基礎攻撃・基礎防御・効果分類を確定するPhase 3から本番有効化前に実施する。Phase 1では戦闘シミュレーションを新設せず、純粋ドメイン上のbucket、ソフトキャップ、セット効果、理論最大値を異常検知用に返す。

## 6. 戦闘接続の推奨構造

### 6.1 型付きDamage/Heal/Statusパケット

最小限、次を持つ攻撃アクション文脈を発射時に作る。

```text
actionId / sourceUnitId / targetUnitId / hitOrdinal / rulesVersion
kind: normalDirect | normalBlast | specialDirect | specialBlast | dot | fixed | selfCost | environment
attackScaling / critEligible / direct / statusSource
outgoingBuffSnapshot / deterministicCritSeed
```

ダメージ順は仕様に合わせる。

1. 基礎ダメージへ攻撃値・次攻撃バフ・与ダメージ補正
2. 対象種別が許可された場合だけ決定論的会心
3. 既存の`damageTakenMul`等
4. ギア被ダメージ軽減（合計40%上限）
5. 既存一撃バリア
6. ギア数値シールド
7. HP

協力ボスのhull/part/CORE倍率は、攻撃側の最終ソースダメージを受け取った後に既存`applyLiveDamage`へ渡す。ボス自身へプレイヤー用装備、防御、シールドは付けない。

回復は実回復量、シールドは実増加量を返す。救援4セットは1以上増えた他者だけを発動対象にする。状態異常は共通`applyStatusEffect`で、`baseChance × (1-resistance)`を一度だけ判定する。

### 6.2 会心の決定性

会心は`Math.random()`に依存させず、`actionId + targetId + hitOrdinal + rulesVersion`から決定する。オンライン双方で同じhitOrdinalを作れることを固定ベクターテストする。通常直撃・通常爆風だけを対象にする場合も、必殺の分類を暗黙にせずマトリクスへ明記する。

### 6.3 救援・背水の「次の攻撃アクション全体」

多段必殺の各弾でバフを消費しない。発射開始時に対象バフを攻撃アクションへスナップショットし、そのアクション配下の全弾・全爆風へ同じ値を使う。アクション解決完了時に一度だけ消費する。

- 同一ソースの救援/背水は上書き
- 別ソースは加算
- DoTの継続tick、自傷、DEAD LINEでは背水を発動しない
- 地形破壊だけの弾、攻撃を伴わない支援、攻撃サブウェポンを「攻撃アクション」と数えるかは承認事項

## 7. 仕様との衝突・補完が必要な値

| 優先 | 項目 | 衝突・不足 | 決定フェーズ・扱い |
|---|---|---|---|
| 必須 | 基礎攻撃 | 現行は通常直撃45等の技別固定値で、キャラ攻撃値なし | Phase 3で`baseAttack=100`正規化か45互換基準かを決定する。 |
| 必須 | 基礎防御 | キャラ防御値・防御式なし | Phase 3で無装備時を完全一致させる互換防御式を決定する。 |
| 解決済み | 固定3部位値 | Phase 0時点では砲身固定攻撃、装甲固定HP、コア固定防御が未確定だった | 固定メイン較正でNormalized 100と★別完成値`[4, 5, 7, 9, 10, 12]`を承認済み。最終戦闘式はPhase 3で決定する。 |
| 必須 | 20〜30%目標 | 実戦差は戦闘式・効果分類未確定では測定不能 | Phase 3〜本番有効化前に標準的な★5〜6完成ビルドで検証する。理論神個体の超過は許容する。 |
| 必須 | 効果分類 | 必殺、多段、DoT、固定、吸収、自傷等のATK/会心/爆風対象が未確定 | Phase 3で全攻撃の効果マトリクスを決定する。 |
| 必須 | PvP改ざん | 正規値再計算は可能だが、ローカル所持の正当性は証明不能 | Phase 3でサーバー正本、署名、PvP規格化/無効のいずれかを決定する。 |
| 高 | 爆風威力 | 現行`blastMul`は半径中心 | ダメージ倍率と半径倍率を分離。爆裂4セットだけ半径+8% |
| 高 | ノックバック | 共通基礎値・耐性なし | 速度倍率の基準、上限、通常弾にKBを付けるか |
| 高 | シールド | 一発バリアのみ | 数値シールド残量、開始時付与順、UI表示 |
| 高 | 協力Seed | party共通かプレイヤー別か不明 | Phase 2でrewardId、Seed、冪等処理と合わせて決定する。 |
| 高 | CPU精算 | runIdと精算回数なし | Phase 2で永続runId、精算通番、再開後の同一性、敗北精算のタイミングを決定する。 |
| 中 | 倉庫満杯 | 未受取10件満杯なら開始禁止の仕様 | どの画面で戦闘開始を止め、既存中断戦はどう扱うか |
| 中 | 報酬保管 | 未受取1件あたりギア数の上限が明記なし | CPU最大5＋協力最大3を前提に固定するか |
| 中 | 制作Seed | 指定箱生成時のSeed源 | transactionId＋制作通番で固定するか |

## 8. PR分割案

### PR 1: 純粋ドメイン基盤

**対象/新規候補**

- 新規 `gear-domain.js`: schema、正規化、Seed PRNG、生成、強化
- 新規 `gear-balance.js`: OP/★/レア度/セット/コストの明示テーブル
- 新規 `gear-loadout-domain.js`: 6部位、セット集計、派生値、GS、分解・制作計算
- 新規 `tests/gear-domain.test.js`
- 新規 `tests/gear-balance.test.js`

**依存**: 設計正本のみ。DOM、localStorage、Firebase、戦闘コードへ接続しない。

**テスト**

- Seed固定ベクターと異なるSeedの分布
- ★/レア度/メイン/サブの全境界
- +3/+6/+9/+12の未来結果再現
- 6部位、同一実物ID、セット2/4、GS、分解、制作コスト
- 固定Seedと抽選境界による品質・セット分布の検証

**ロールバック**: 新規ファイルとテストだけを戻す。ゲームから未参照なので挙動・保存へ影響なし。

**完成条件**: 同じ入力は常に同じ完全ギアを返し、丸め・上限が明示される。Phase 1完了時点では固定3部位の未確定値をfail closedで扱い、後続の固定メイン較正で正式値を解決した。戦闘実測は含めない。

### PR 2: 保存・倉庫・報酬基盤（2A→2D）

**Phase 2A: 保存schema / migration**

- 新規 `gear-storage.js`: `katamon_gear_v1`、migration、厳格save、容量計測

**Phase 2B: 倉庫 / 一時BOX / 未受取 / transaction / idempotency**

- 新規 `gear-transaction.js`: 冪等ジャーナルと復旧
- 新規 `gear-rewards.js`: rewardId、未受取、倉庫、一時BOX、受取・復旧の純粋処理
- 新規 `tests/gear-storage.test.js`、`tests/gear-rewards.test.js`、`tests/gear-transaction.test.js`

**報酬接続前の依存解決**

Phase 0時点で未確定だった固定3部位の本番tuningは、Phase 2A/2Bを先行した後、固定メイン較正で解決済みである。Phase 2C/2Dは承認表を使って全6部位を生成できるが、最終Attack/Defense戦闘式は先取りせずPhase 3へ残す。

**Phase 2C: CPU報酬**

- `index.html`: CPU `runId`・精算状態を保存基盤へ接続。大型UIはまだ追加しない。

**Phase 2D: 協力ボス報酬**

- 必要最小限 `coop-mvp-battle.js` / `coop-mvp-rewards.js`: 確認済み`enterResult`経路へ、保存済みの冪等報酬を接続する。結果コーディネータの新設・統一リファクタリングは証拠がある場合だけ検討する。

**依存**: PR 1。

**テスト**

- v0/破損/将来versionからの安全なmigration
- 500/50/10境界、満杯時の戦闘開始拒否判定
- 同一rewardIdの再試行、二重タップ、リロード、途中例外、容量超過
- コインだけ成功/ギアだけ成功の中断からの復旧
- CPU中断→再開→精算、敗北降格、協力初回追加枠
- NORMAL 1650/12、既存コイン、初回クリア、ショップ、実績の回帰

**ロールバック**: 機能フラグをOFFにし、旧クライアントは別キーを無視する。既に保存された`katamon_gear_v1`は削除せず、将来再利用できる。残留ジャーナルは読取専用復旧コードを残す。

**完成条件**: 保存失敗時に報酬を消費せず、再実行しても増殖せず、最大容量で既存保存を壊さない。2C/2D接続時は、確認済みの統合協力結果経路でコイン・初回・ギアを一度だけ確定する。

### PR 3: 装備・プリセット・戦闘反映

**対象/新規候補**

- 新規 `gear-combat.js`: 派生戦闘値、Damage/Heal/Status、action context
- 新規 `gear-presets.js`: 3プリセット、モード既定、共有ギア競合解決
- 変更 `index.html`: 各ダメージ/回復/状態経路、開始時ロードアウト固定、オンラインsnapshot/fire/commit-reveal
- 変更 `database.rules.json`: 装備パケットの形・サイズ・version・hash検証
- 必要最小限 `coop-mvp-boss.js`: プレイヤー攻撃パケットから既存装甲計算へ接続
- 新規 `tests/gear-combat.test.js`、`tests/gear-presets.test.js`、オンラインloopback回帰

**依存**: PR 1、PR 2、基礎攻撃/防御とPvP方針の承認。

**テスト**

- ギア無効・空装備で全代表攻撃のHP、爆風半径、KB、状態が現行と完全一致
- 通常直撃/通常爆風だけ会心、DoT/固定/回復は非会心
- 多段必殺が同一actionIdを使い、救援/背水を一度だけ消費
- 防御→軽減→既存バリア→数値シールド→HPの順序
- 状態異常耐性、回復・シールド上限、爆風半径分離
- 6部位/3プリセット/共有ギア競合
- 両端末が同じloadout hashと会心結果を再計算
- 改ざんraw modifier、不正gear、重複ID、未知rulesVersionを拒否
- CPU、オンライン、協力ボスの全回帰

**ロールバック**: 戦闘反映フラグOFFで現行経路を完全使用。新装備データは保持。Firebaseルールは、旧クライアント互換期間を設けてから段階的に戻す。

**完成条件**: 全モードへ同じ純粋派生値を適用し、相手送信の最終数値を信用せず、無装備時は現行戦闘と一致する。

### PR 4: Core UI

**対象/新規候補**

- 新規 `gear-ui.js`、必要なら `gear-ui.css`
- 変更 `index.html`: `TITLE_MENU_PAGES[garage].items`と既存遷移ハンドラへ追加
- 装備、倉庫、強化、分解、比較、GS、報酬受取の画面
- CPU結果の「連勝を続ける/報酬を受け取る」導線
- 協力結果の獲得ギア表示

**依存**: PR 1〜3。

**テスト**

- GARAGEの既存ショップ/実績/サウンドテスト遷移
- 空倉庫、満杯、未受取、保存失敗、二重タップ
- Android縦画面、スクロール、戻る、pointer競合、文字はみ出し
- CPU中断・再開、協力結果、PWA更新、BGMの回帰

**ロールバック**: GARAGE項目と画面起動フラグだけを戻す。保存済みギアと戦闘フラグは維持可能。

**完成条件**: スマホ縦画面で主要操作が完結し、既存タイトル2ページと既存GARAGE機能を崩さない。

### PR 5: 追加UX

**対象/新規候補**

- 一括強化、検索プリセット、常設ガイド、演出、フレーバー名
- 機種変更コード、圧縮/復元、必要なら専用モジュールと素材
- UI本体と個別機能フラグ

**依存**: PR 1〜4。機種変更コードは最大実データのAndroid測定後。

**テスト**

- 検索条件のAND/OR、ロック・お気に入り・使用中除外
- 一括操作の全件成功/全件失敗と中断復旧
- ガイド導線、演出スキップ、低性能端末
- 圧縮コードの往復、改ざん、version違い、最大長コピー

**ロールバック**: 各追加UXを個別フラグで無効化。Core UIとデータは保持。

**完成条件**: 追加機能がCore操作を阻害せず、最大データでも実機上の時間・長さ基準を満たす。

## 9. Phase 1で最初に作るテスト

実装より先に、次の順で赤いテストを作る。

1. **Seed golden vector**: 同じ`generationSeed`からgearId、部位、セット、★、レア度、メイン、サブ、enhancementSeedが完全一致する。
2. **強化未来固定**: +0で確定したSeedから+3/+6/+9/+12の対象サブと増加値を再現でき、リロードしても変わらない。
3. **境界表テスト**: 全★・全レア度・全部位・全OP・同一メイン/サブ許可を仕様表どおり網羅する。
4. **重複・競合テスト**: 1ギアを複数プリセットに登録できるが、同一試合の複数出撃キャラでは競合規則どおり一方だけ有効になる。
5. **集計順序テスト**: 攻撃/HP/防御は加算後1回適用、与ダメと会心は別乗算、ソフトキャップ境界が一致する。
6. **GS/分解/制作テスト**: 入力から一意のGS・粉末・設計片・コストを返し、表示値と保存値がずれない。
7. **バランス境界レポート**: 無装備、代表★4〜6、理論最大について、固定値bucket、割合値bucket、ソフトキャップ、セット、条件付き効果を返す。実戦比較はPhase 3へ残す。

PR 1ではゲーム画面やlocalStorageへ接続せず、このテスト群が通る純粋関数だけを作る。

## 10. 推奨モデル・エフォート

- Phase 1の数値表・Seed・境界設計: **Sol High**。正本の数値を変えず、当時の未確定値をfail closedで隔離する重要設計。固定3部位は後続の固定メイン較正で解決済み。
- PR 1の明確化後の純粋関数実装: **Terra Medium〜High**。
- PR 2のトランザクション・migration・報酬冪等性: **Sol Highで設計監査、Terra Highで実装**。
- PR 3の戦闘/オンライン統合: **Sol High**。既存全モードと改ざん耐性へ影響する。
- PR 4/5のUI実装: **Terra Medium〜High**、最終監査は**Sol Medium〜High**。

## 11. 今回変更していないもの

- ゲーム挙動、戦闘定数、キャラ性能
- 協力ボスNORMALの基礎HP 1650、12巡、CORE 2ラウンド
- HARD/EXTREME
- タイトルBATTLE/GARAGE 2ページUIと既存導線
- CPU連勝、中断、再開、敗北リセット
- オンライン通信、Firebaseルール
- カタコイン、ショップ、実績、サウンドテスト
- localStorageの既存データ
- build/version、Service Worker、公開サイト

Phase 0のファイル変更は、添付仕様の正本`docs/gear-system-v1.md`と本監査文書だけである。

## 12. 実装前に承認が必要な判断

### Phase 2で承認・決定する事項

1. `katamon_gear_v1`等の保存方式、migration、transaction journal
2. rewardId、未受取、冪等処理、協力報酬Seed
3. CPUの`runId`生成・精算通番、未受取満杯時の既存中断戦の扱い

### Phase 3で承認・決定する事項

1. 基礎攻撃・基礎防御の互換式
2. 通常・各必殺・DoT・固定・自傷・吸収・地形のATK/会心/爆風/背水対象マトリクス
3. PvPをサーバー所持品正本、署名済み装備、規格化、ギア無効のどれにするか
4. 標準的な★5〜6完成ビルドによる20〜30%の実戦差検証

### Phase 2C/2D開始前に解決する依存

砲身・装甲・コアの固定3部位の★別完成値は、Phase 1では未注入・fail closedとしていたが、固定メイン較正でNormalized 100と`[4, 5, 7, 9, 10, 12]`を承認し解決済みである。Phase 2C/2Dの完成ギア報酬はこの表を使用できる。Phase 3の戦闘反映は、Phase 3の判断事項をすべて承認後に進める。
