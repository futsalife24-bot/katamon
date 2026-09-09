# カタモン 現在地レビューと改善アクションプラン

作成日: 2026-09-09 / 対象: `futsalife24-bot/katamon` `master` = `7625838`（PR #393 merge）

この文書は、実装済み機能の良し悪しではなく **「今の開発体制のまま次の機能を積めるか」** を判定した結果である。
ゲーム企画・遊びの中身は既に [`docs/実装計画_統合版.md`](../実装計画_統合版.md) と
[`docs/レビュー_Fable5_統合計画反証.md`](../レビュー_Fable5_統合計画反証.md) が正本なので重複させない。
ここで扱うのは **CI・現在地文書・PR滞留・コード基盤・意思決定の空白** の5点である。

---

## 0. 結論（3行）

1. **機能開発は速いが、土台の整備が追いついていない。** 30日で126コミット・PR #379〜#393を統合する一方、CIはmasterが赤のまま放置され、正本文書は9コミット分古い。
2. **最優先タスクの3件すべてが「進められない状態」で固定されている。** 3D-8Dは外部条件待ち、実機GOAL QAは手順書がリンク切れで存在せず、Gear UI残件だけが着手可能。
3. **止血（P0）は合計1〜2日で終わる。** その後に基盤整理（P1）へ進めば、企画側の実装計画をそのまま載せられる。

---

## 1. 現在地サマリ（実測）

| 項目 | 実測値 | 確認方法 |
| --- | --- | --- |
| master HEAD | `7625838`（PR #393, 2026-09-08） | `git log` |
| 公開BUILD | `v2.0.176-content-studio-registration` | `sw.js:1` |
| master CI | **失敗**（run `34221371257` / run_number 888、`test` job） | Actions |
| 直近30日のコミット | 126 | `git log --since="30 days ago"` |
| Open Issue | 3件（#4 / #6 / #8、いずれも2026-08-02起票） | GitHub |
| Open PR | 15件（うち12件が8/22起点のstacked draft） | GitHub |
| `index.html` | 1,722,122 byte / 31,461行、うち単一inline scriptが1,428,547 byte・30,512行 | 実測 |
| 起動時JS/HTML | 約2.58 MB（非圧縮、`index.html` + 外部script 47本 856 KB） | 実測 |
| `package.json` scripts | 142本、`npm test` は68段の逐次 `&&` チェーン | 実測 |
| テストファイル | `tests/` 133件、`tests/e2e/` 28件 | 実測 |
| リポジトリ容量 | 164 MB（うち `assets/` 153 MB） | `du -sh` |
| lint / 型チェック | **ゲーム本体は0件**（root に eslint/prettier/tsconfig なし） | 実測 |

### 強みとして維持すべきもの

土台の弱点を挙げる前に、明確に良い部分を記録しておく。以下は削らない。

- **テスト規律**。「壊した旧実装で先に失敗させてから追加する」ルールと、133本のNodeテスト＋28本のPlaywright E2Eは個人開発として異例の水準。
- **`tests/seatharness.js` の設計**。`index.html` からinline scriptと外部scriptを実ブラウザと同じ順で抽出し、`module`/`require` を潰した上で評価する（`tests/seatharness.js:17-44`）。テストが本番コードそのものを検証しており、ロジックの二重実装が発生していない。
- **保存の堅牢性**。WAL、intent再試行、read-back、二重加算防止、queue/ledger分離が報酬系全体で一貫している。
- **PWA precacheの段階化**。T1〜T3bの優先順位と「6.70 MBテーマは最後」という明示的な設計（`sw.js:69-120`）は、初回体験を守る意図が正しく効いている。
- **1PR・1目的の運用**と、PRごとの「何を / なぜ / やってはいけないこと / 実測テスト数」の記録。

---

## 2. 改善点（優先度順）

### P0-1. masterがCIレッドのまま放置されている

**事実**: run `34221371257`（PR #393 merge、2026-09-08 11:34 UTC）の `test` job が失敗。約1日以上、赤いまま。

```
not ok 2 - turn timing, runtime pickup paths, durable resource escrow, and snapshot replay are integrated
  location: tests/stage-battle-items-runtime.test.js:17:1
  stack:    tests/stage-battle-items-runtime.test.js:79:10
  Expected values to be strictly equal: false !== true
```

`tests/stage-battle-items-runtime.test.js:79` は
`assert.equal(jumpLanding.collected, true, 'teleport jump landing must use the production pickup hook')`。

**これはPR #393の不具合ではない。テスト側の非決定性である。** 本セッションで
`node --test tests/stage-battle-items-runtime.test.js` を25回、`node --test tests/stage-*.test.js` を5回、
`master` HEADで実行したが**失敗0件**。

同種の失敗が2026-09-04にも起きている（run `33853607883`、PR #381 merge）:

```
NG   希少CPU勝利は通常連勝精算と別のstable rewardを一度だけqueue/read-backし、結果操作を完了まで止める
AssertionError: a deterministic rare vector is required
  at tests/gear-cpu-integration.test.js:942
```

**根本原因は共通している。「ランダム生成された状態から条件を満たすケースを探索する」テスト構造。**

- `tests/gear-cpu-integration.test.js:996-1001` は、ランダムな `runId` に対して `matchOrdinal` を3〜99まで回し、独立5%の希少個体を引けることに賭けている。1回も引けない確率は `0.95^97 ≒ 0.7%`。**約140回に1回、必ず落ちる設計**。
- `tests/stage-battle-items-runtime.test.js` も同様に、ランダム生成された地形上で `if (!spawnedAtFirstEligibleTurn)` と分岐し、ジャンプ着地地点の成立を地形任せにしている。

このrun `33853607883` の赤は**修正されていない**。次のrunがたまたま緑になって流れただけである。
つまり現状、CIの赤が「直すべき信号」として機能していない。

**影響**: 本当の回帰が混ざったとき区別できない。「またフレークだろう」で通してしまう体制ができあがりつつある。

### P0-2. 正本文書 `CURRENT_WORK_STATE.md` が実態から乖離している

`AGENTS.md` は「作業開始時に `CURRENT_WORK_STATE.md` を読む」「日付入りの古いHANDOFFと食い違う場合はこれを優先する」と定めているが、当のファイルが古い。

| 項目 | CURRENT_WORK_STATE.md | 実際 |
| --- | --- | --- |
| 最終更新 | 2026-09-05 | — |
| 公開BUILD | `v2.0.174-weekday-battle-dungeon` | `v2.0.176-content-studio-registration` |
| 最新統合PR | #384 | #393 |
| 未記録のコミット | — | 9件（#386〜#393のcontent-studio 4件、roster pin、registry approval、mobile pointer fix を含む） |

さらに構造的な問題として、**サイズ上限に到達しつつある**。`test:docs` は30 KB超をCI失敗にする規約だが、現在27,507 byte、**残り2,493 byte**。
1PRあたりの追記が数百byte単位なので、あと数PRで「規約違反か、記録を書かないか」の二択になる。
完了済み詳細を `docs/CHANGELOG.md` へ移す運用が、実際には回っていない。

### P0-3. 最優先タスクの参照先が存在しない

`README.md` は実機GOAL QAについて
「`docs/tasks/2026-09-04-real-device-goal-handoff.md` のP0として別途保留する」
と書いているが、**このファイルはリポジトリに存在しない**（`docs/tasks/` 配下15ファイルを確認済み。リンク切れはこの1件のみ）。

`CURRENT_WORK_STATE.md` の最優先タスク3件を実行可能性で分類すると：

| # | タスク | 実行可能か |
| --- | --- | --- |
| 1 | Phase 3D-8D Production Acceptance | **不可**。「安定した複数verification client」という外部条件待ち。いつ満たされるかの定義がない |
| 2 | Gear UIのpresentation残件（320px Presetプレート、「authority側」文言） | 可 |
| 3 | 既存Issue #4 / #6 / #8 の保持 | #8は1の完了待ち。#4 / #6は着手可 |
| （README記載） | 実機GOAL QA（P0） | **不可**。手順書が存在しない |

つまり「最優先」と宣言されている4件のうち2件が着手不能で、その状態が固定化している。
実際の開発リソースは最優先タスクではなく Content Studio（#386〜#392）へ流れており、**宣言された優先順位と実際の作業が一致していない**。

### P1-1. Open PRの滞留（15件）

| PR | 内容 | 状態 |
| --- | --- | --- |
| #265〜#276（12件） | 協力戦シリーズ（ロビー／ボス／サブウェポン／実績／ショップ／救助弾） | 全てdraft、**8/22から18日停滞**。各PRのbaseが別のPRのブランチという連鎖構造で、先頭が動かない限り全部動かせない |
| #362 | ONLINE 公開部屋0件と一覧通信失敗を分離 | draft、9/01から停滞。**Backlog 4番と同一内容**。作業済みのものがBacklogに未着手として再掲されている |
| #83 | docs: v145の公開状態を記録 | 非draft、**8/09から31日停滞** |
| #392 | content-studio Cloud Run packaging | draft、9/06。現在進行中と思われる |

Backlog 2番は既に「#265〜#276と#83を整理する」と認識しているが、**認識されたまま18日動いていない**。
`master` は既に協力戦系（`coop-mvp-*.js` 11ファイル）を持っているため、これらのdraftが今も有効かどうか自体が不明。

### P1-2. `index.html` 単一モノリスの限界

- 単一 `<script>` に **30,512行 / 関数1,391個 / モジュールスコープ宣言4,535個**。全部が同一スコープを共有している。
- `document.getElementById` 139回、`addEventListener` 117回が同じスコープに混在。
- **lint・フォーマッタ・型チェックが1つもない**（root に eslint / prettier / biome / tsconfig いずれも不在）。1.4 MBのJavaScriptが、構文チェックすらCIで走っていない。
- 起動時の非圧縮ペイロードは約2.58 MB。GitHub Pagesのgzipで実転送量は下がるが、**モバイル端末のパース・実行コストは圧縮では下がらない**。

一方、同じリポジトリの `tools/content-studio/` は React + TypeScript + Vite + vitest + `typecheck` script を完備している。
**必要な道具はリポジトリ内に既にあり、ゲーム本体だけが取り残されている。**

`tests/seatharness.js`（2,301行）はこのモノリスを検証するために書かれた優れた回避策だが、
文字列パッチでテストフックを注入する構造そのものが、モノリスが払わせているコストである。

### P1-3. npm scriptsの命名がフェーズ名に固定されている

142本のscriptのうち大半が `test:gear-online-battle-reentry-activation-phase3d8b3b2`、
`test:e2e:gear-tab-level-alignment-phase4t` のような**開発フェーズ名**を恒久的な名前として持っている。

- フェーズが終わっても名前が残るため、**何を守っているテストなのか名前から判別できない**。
- `npm test` は68段の逐次 `&&`。1つ落ちると以降が走らないため、**1回のCIで全体の健康状態が取れない**（P0-1のrunも34秒で停止し、後続テストの結果は不明のまま）。
- `pretest` にも9段のFirebase系チェーンがあり、`npm test` の前段が暗黙に走る。

### P1-4. Phase 3D-8D の完了条件が定義されていない

「production acceptanceは安定した複数verification clientを維持できない外部検証条件により未完了」「新しいコード障害が確定した状態ではない」と記録されているが、
**いつ・何が揃えば再開するのかの条件が書かれていない**。結果としてIssue #8 と最優先タスク1が無期限に開いたままになっている。

コードは緑、外部条件だけが不足という状態なら、これは「未完了タスク」ではなく「条件付き保留」として扱うべきで、
最優先タスクの枠を占有し続けるべきではない。

### P2-1. `assets/` 153 MB をGitに直接格納

リポジトリ164 MBのうち153 MBがバイナリ資産（`assets/gear` 29 MB、`assets/ui` 15 MB、`assets/characters` 15 MB、単体6.8 MBのmp3など）。
Git LFS未使用のため、全履歴がcloneに乗る。CIの `actions/checkout` が毎回これを引く。
差し替えのたびに履歴が単調増加するため、**今後さらに悪化する一方**の項目である。

### P2-2. GitHub Actions の Node 20 deprecation

`actions/checkout@v4` / `actions/setup-node@v4` に対して毎run警告が出る（Backlog 3番として認識済み）。
機能変更と分離したCI保守として、v5への更新1PRで閉じられる。

### P2-3. 「サーバーを持たない」という設計原則の転換が未決定

`README.md` は「新しいサーバーは設置していない」「通常利用にアカウント、外部AI、APIキー、有料サービスは必要ない」と明記している。
一方 PR #392 は Content Studio の **Cloud Run 本番ランタイム** をパッケージングしており、`tools/content-studio/` には既に `server/`、`tsconfig.server.json`、`production:start` が存在する。

これは良し悪しの問題ではなく、**運用コスト・可用性・秘密情報管理・README記載の前提すべてに波及する方向転換**である。
現時点でその意思決定を記録した文書がない。#392をmergeする前に明文化すべき。

---

## 3. アクションプラン

原則は既存運用どおり **1PR・1目的**。各PRに完了条件を付ける。

### P0（止血・合計1〜2日）

#### A1. フレークテストの決定化 — `fix/deterministic-test-fixtures`

対象は「ランダム状態から条件を探索している」2箇所。

1. `tests/gear-cpu-integration.test.js:996-1001`
   ランダム `runId` に対する希少個体の探索をやめ、**希少個体が必ず成立する固定 `runId` / `matchOrdinal` をテスト内に定数として置く**。
   探索ループが必要な場合も、上限到達を「テスト環境の不備」として明示的に失敗させるのではなく、固定ベクタで再現する。
2. `tests/stage-battle-items-runtime.test.js:20-31, 74-80`
   ランダム地形依存をやめ、**固定シードのステージ**でジャンプ着地・アイテム配置を成立させる。
   `if (!spawnedAtFirstEligibleTurn)` の分岐は、両方の経路を別テストとして明示的に検証する形へ分ける。

**完了条件**: 各テストを50回連続実行して0失敗。`npm test` がmasterで緑。
**やってはいけないこと**: 該当assertionのskip・削除・`t.skip` 化、リトライでの誤魔化し。乱数を固定するのはテスト側だけで、本番の抽選ロジックには一切触れない。

#### A2. 現在地文書の再同期 — `docs/current-state-resync-20260909`

- `CURRENT_WORK_STATE.md` を `master` = `7625838` / BUILD `v2.0.176` の実態へ更新。PR #386〜#393（content-studio 4件、roster pin、registry approval、mobile pointer cancel）を追記。
- 同時に **完了済みPhase 4A〜4Hとv2.0.39〜v2.0.56の詳細を `docs/CHANGELOG.md` へ移送**し、本文を20 KB以下へ落とす。30 KB上限まで10 KBの余裕を確保する。
- 最優先タスクを「着手可能」と「条件付き保留」に分けて書き直す（A4と連動）。

**完了条件**: `npm run test:docs` 通過、ファイルサイズ20 KB以下、`git log` との差分ゼロ。

#### A3. 実機GOAL QA手順書の作成 — `docs/real-device-goal-handoff`

`README.md` が参照する `docs/tasks/2026-09-04-real-device-goal-handoff.md` を実際に作る。
既存の [`docs/mobile-stage-studio-qa.md`](../mobile-stage-studio-qa.md) を雛形にし、最低限：対象端末・OS・実施手順・合否判定・不合格時の記録先。
**書けない場合は、READMEのリンクを外して「P0だが手順未定」と正直に書く。** 存在しない文書を指し続けるより良い。

**完了条件**: リンク切れ0件（`README.md` / `CURRENT_WORK_STATE.md` / `AGENTS.md` の相対リンク全チェック）。

#### A4. Phase 3D-8D の再開条件の明文化 — `docs/3d8d-acceptance-gate`

「安定した複数verification client」の具体的定義（台数・OS・回線・同時保持時間）と、それが揃った時の再開手順を書く。
その上で、最優先タスク1を **「条件付き保留」へ格下げ**し、最優先枠をA1〜A3と着手可能なGear UI残件へ譲る。

**完了条件**: Issue #8 に再開条件をコメントし、`CURRENT_WORK_STATE.md` の該当節と一致させる。
**やってはいけないこと**: 条件が揃っていないのに「COMPLETE扱い」にすること。3D-8Dのコードには触れない。

### P1（基盤・1〜2週間、A1〜A4完了後）

#### B1. Open PRの棚卸し — `docs/open-pr-audit`（コード変更なし）

#265〜#276の12件を `master` actual と1件ずつ照合し、**統合済み / 代替済み / 継続** の3分類の台帳を作る。
`master` は既に `coop-mvp-*.js` を11ファイル持つため、多くは「代替済み」に落ちる見込み。
#83（31日停滞）は内容がv145で既に歴史的資料。#362はBacklog 4番と同一なので、**どちらか一方に寄せる**。

**完了条件**: 台帳PRのmerge後、分類が確定したPRをcloseまたはready化。
**やってはいけないこと**: 台帳を作る前のmergeとbranch削除（既存の運用ルールどおり）。

#### B2. CIに構文チェックの最低ラインを入れる — `ci/add-syntax-and-lint-gate`

型付けや全面lintではなく、**「壊れたJSがmasterに入らない」ことだけ**を保証する最小構成から始める。

1. `index.html` のinline scriptと `shared/*.js` / `coop-mvp-*.js` を `node --check` 相当で構文検証するscript（`tests/seatharness.js:17-44` の抽出ロジックを再利用できる）。
2. `stage-studio-ci.yml` の `test` job に1ステップ追加。
3. ルール追加はここまで。styleルールの導入は別PR。

**完了条件**: 意図的に構文エラーを入れたブランチでCIが赤になることを確認。既存テストの件数は不変。

#### B3. `npm test` の分割と可視化 — `ci/split-test-suites`

- 68段の単一チェーンを、**gear / online / coop / stage / existing / weekday の6グループ**へ分割し、CIでmatrix並列実行する。
- 1グループの失敗が他を止めなくなるため、**1回のrunで全体像が取れる**ようになる。
- scriptの改名はこのPRでは行わない（差分を小さく保つ）。改名はB4へ分離。

**完了条件**: 全グループの合計テスト件数が現行と一致。CI所要時間が現行（`test` job）以下。

#### B4. scripts命名の整理 — `chore/rename-phase-scripts`

`phase3d8b3b2` のようなフェーズ名を、守っている対象を表す名前（例: `test:online-reentry-activation`）へ改名。
旧名はエイリアスとして1バージョン残し、`docs/` の参照を追従させる。142本を一度にやらず、**gear系 / online系 / coop系で3PRに分ける**。

#### B5. `index.html` のモジュール切り出し（着手判断のみ、実装は次段）

いきなり分割しない。まず **「どこから切れるか」の調査PR**（docs only）を出す。
すでに `shared/*.js` 47本という切り出し実績があるので、同じ手口が使える領域（描画ユーティリティ、UI組み立て、音声）を特定し、
`tests/seatharness.js` の抽出ロジックを壊さない切り出し順序を決める。

**やってはいけないこと**: 分割と機能変更を同一PRに混ぜること。loopback中継数の基準値 38 / 64 / 83 / 61 / 48 を説明なく動かすこと。

### P2（継続・優先度低）

- **C1.** `actions/checkout@v5` / `actions/setup-node@v5` へ更新（Backlog 3番）。機能変更と分離した単独PR。
- **C2.** `assets/` のGit LFS移行を検討。**履歴書き換えを伴うため、実施可否はユーザー判断**。判断材料（clone時間、CI checkout時間、月間増加量）を先に測る調査PRから。
- **C3.** Content Studio のサーバー方針を明文化（P2-3）。`README.md` の「新しいサーバーは設置していない」を、Cloud Run前提の記述へ更新するか、Content Studioを別リポジトリ・別運用として切り出すかを決める。**#392のmerge前に決める。**

---

## 4. 実行順ロードマップ

```
Day 1        A1 フレークテスト決定化   → masterを緑にする（他の全作業の前提）
Day 1-2      A2 現在地文書の再同期 + CHANGELOG移送
             A3 実機GOAL QA手順書（または正直なリンク削除）
             A4 3D-8D再開条件の明文化
─────────────  ここまでで「最優先タスクが全部着手可能」な状態になる  ─────────────
Week 1       B1 Open PR棚卸し（15→整理）
             B2 構文チェックgate
Week 2       B3 test分割・並列化
             C1 Actions更新
Week 3-      B4 scripts改名（3PR）
             B5 index.html分割の調査PR
             C3 サーバー方針の決定（#392より前）
以降          docs/実装計画_統合版.md の採用企画へ着手
```

**依存関係**: A1はすべての前提（CIが信用できないと他の変更の安全性を確認できない）。
B3はB2の後（構文チェックが並列化で消えないように）。
C3は#392のmergeより前。B5の実装はB2・B3の完了後。

---

## 5. この文書の扱い

- 本文書は2026-09-09時点の `master` = `7625838` に対する評価である。A1〜A4完了後は `CURRENT_WORK_STATE.md` が正本へ戻るため、本文書は履歴資料として `docs/tasks/` に残す。
- ゲーム内容・企画の優先順位については [`docs/実装計画_統合版.md`](../実装計画_統合版.md) を上位とする。本文書はその実行体制側の前提条件を扱う。
- P0の4件は既存の禁止事項（Firebase Rules/Console変更、protocol/wire/schema変更、手動Pages deploy）に一切触れない範囲で完結する。
