# Content Studio Completion Phase 1 — 公開安全性・復旧の監査記録

> PR #386の外部監査HOLD後の修正は [Phase 1-R1再監査記録](content-studio-completion-p1-r1.md) を参照。以下の試験件数・制限は初回提出時点の記録。

日付: 2026-09-05。実装・設計安全性判断: Astra。外部テクニカルリード／独立監査は別セッション。これは実装側の証拠記録であり、MERGE GOでもContent Studio全体の完成宣言でもない。

## GitHub actual と隔離

- Repository: futsalife24-bot/katamon、default/base: master
- 開始・コミット直前の origin/master: 9c4e8373f6f036fe07e4666cc6d435836920f8af。外部監査の観測値と一致。base driftなし。
- Branch: codex/feat/content-studio-completion-p1-publish-safety
- 新規worktree: .codex-worktrees/content-studio-completion-p1。旧Studio worktreeを再利用せず、旧コードを一括復元していない。
- 開始時にgit status、worktree一覧、open PR、Studio branch/PR、AGENTS.md、CURRENT_WORK_STATE.md、README、関連docs、tests/READMEとworkflowを確認。旧Studio PR #240/#242はmerge済み。他PR/worktreeと正本の既存未追跡ファイルは保護。
- 再確認API: branches/master protected=false、rulesets=[]。保護を有効とは扱わない。管理設定変更、本番master書き込み試験、PR mergeを実施しない。
- この記録を含む1 commitをDraft PRへ提出。確定head/PR URL/CI run URLはPR本文・最終報告を参照（自己参照SHAをcommitへ埋め込まない）。workflowは実checkout SHA、PR head/base、run/attemptをログへ出力する。

## 外部指摘の確認と優先度

「静的確認」はコードの制御フローを確認したこと、「再現」はfixture/ローカル試験で再現したこと。実GitHubのデータ消失事故が起きたとは主張しない。

| 指摘 | 修正前の確認 | 優先度 | 実装・証拠 |
|---|---|---|---|
| 本体18体／Studio17体 | index.html LEGACY_CHARACTER_LISTにhamulton、Studio一覧/schema/画像allowlistに不在。照合テスト修正前失敗 | P1 | domain/legacy-characters.ts、schemas.ts、generation/catalog.ts、vite.config.ts。全18体の一覧順序・名前・asset存在・保存identityを試験 |
| 不完全公開一覧を正常空とする | published-content.tsのcontinue、warning:null、404の空扱いを静的確認。追加テスト修正前失敗 | P1 | complete/partial/unavailable、失敗分を警告、成功分保持、一覧再試行。完全な空manifestだけcomplete |
| ブラウザcatalogとGitHub baseが同一保証なし | artifacts.ts / controllerのpublishedCharacters参照を静的確認 | P1 | snapshot.ts reconstructSnapshotは固定Git treeを正本に再構成。A→B→A・古いPages・削除claim拒否をfixture再現 |
| 参照・全体再構成不足 | validation.tsの個別検証は存在するが集合保証が不足。静的確認 | P1 | canonical全件のschema/path/ID/slug、全参照存在・所有directory・MIME/hash・metadata・sprite寸法を照合 |
| 準備メモリ、branch応答喪失、TTL/restart | repository-service.tsのMap/30分/pendingCommitSha保存順を静的確認。実サービス事故未検証 | P1 | attestation付きcommitと決定的branch、GitHub再照合。二重・並行・各応答喪失・restart/TTL/再認証をfixture再現 |
| 見えているCIのみ／merge base確認不足 | github-api.tsの1ページ/neutral/skippedとmerge条件を静的確認 | P1 | ci-policy.ts/getChecks、必須2ジョブの最新run/attempt/head/app＋status contexts、paging、保護不足はmerge停止 |
| 容量契約の差 | frontend 8/16/20MiB相当とbackend 6/16/24MiB・32件を静的確認 | P1 | publish-limits.tsを共有、実UTF-8/Base64 request検査、生成直後の超過表示と保存継続 |
| master無保護/rulesetなし | GitHub read-only APIで再確認 | P1 外部未完 | 自動mergeを停止。必要な管理者設定はserver/README.mdに明記 |
| server-mode native fetch呼出し | 新mobile E2EでIllegal invocationを再現（APIリクエスト未到達） | P1 | gateway default fetchを関数ラッパーへ修正、3幅とも成功 |

P0として確認された実事故はなし。未知の本番事故を推測して格上げしていない。P2/P3の後続事項は末尾参照。

## 実装の保証

1. 既存一覧はLEGACY_CHARACTERSを単一入口にschema/予約ID/slug/画像allowlist/件数へ展開。ゲームID doRednote / coolKaiと保存用 do-rednote / cool-kaiを維持する。ゲームは手書き定義のまま。全18体について、motionSheets/motionMetadata以外の全game fieldsが不変であることをroot試験で確認。
2. backendが固定baseの全canonicalと参照画像を読む。今回の1体だけ置き換え、他のrecordsから同じ生成関数でcatalog/manifestを作る。ブラウザの全体ファイルは省略でき、提出された場合は正本とのbyte一致が必須。Pages遅延や取得失敗から削除差分を作らない。canonical/参照取得に失敗すれば準備は停止。
3. 差分にはbase SHA、path、byte数、SHA256、テキスト内容を返す。commit直前に同じsnapshot digestを照合し、復旧時は全Git treeとsingle parent・HMACを再検証する。別キャラのfile提出、欠落/不正参照、大小文字衝突、既存画像の上書きは拒否。
4. 同じ操作のbranchはactor numeric ID・repo/base ref・bundle digestのHMACで一意化。process内Promiseで二重送信をまとめ、process間はGitHub branch/PRの一意性と再照会で収束する。競合した未参照Git objectができる場合はあるが、重複branch/PRを作らない。失われたmerge応答は既存PRのmerged状態とmergeCommitShaで復旧。
5. 必須CIはworkflow実名から固定。最新run/attemptに属するjobsと対応check-run、GitHub Actions app、対象headを照合。欠落、開始遅延、実行中、failure/cancelled/timed_out/skipped/neutral等は通さない。追加required status contextと全最新statusも成功が必要。読み切れないページ数は停止。
6. mergeはPR repo/base ref/head ref/state、期待head、検証済base、厳格な保護を再照合。直前GETだけでは原子的なbase競合防止にはならず、GitHub側のstrict required checks/enforce_admins/no bypassとの組合せが必要。actual無保護なのでmerge APIを呼ばない。base driftや改変headの自動rebase/force pushはしない。
7. 元下書き・生成画像・bundleを保持。公開前にoutbox保存し、再読込/再認証/restart/TTL後は同じbundleで既存PRを再発見。TTLは延長せず再準備する。署名に必要なSESSION_SECRETを安定保持。秘密はoutboxへ保存しない。キャンセルは待機終了であり送信済み書き込み取消ではない。
8. 6MiB/file・16MiB/total・32 files・24MiB/request（Base64/JSONを含む）を共有。環境変数は下げることだけ可能。生成直後はmotion画像を検査、全生成後は全file、送信直前は実UTF-8 request、serverは独立に再検査。JSON階層32、stream容量、snapshot 500 records/256MiB、準備キャッシュ16操作/64MiBでbounded。画像を黙って間引かない。

後方互換: canonical schema versionやゲームの解釈方法は変更しない。旧outboxの追加fieldはoptional。旧準備IDは再準備が必要。Phase 1以前の無署名PRは自動復旧対象にせず安全に停止。静的ZIPは編集/参考成果物でありGitHub最新snapshotを保証する公開物とは表示しない。

## 検証記録

対象: 上記base上のこのPRの変更一式。以下はローカルWindows、Node v24.14.1の実行。CIはNode 22/Ubuntuで同じPR headを再検証し、結果をPR本文に追記する。

| コマンド | exit | 最終結果 |
|---|---:|---|
| tools/content-studio: npm ci | 0 | 113 packages。依存追加なし・lock不変 |
| npm run typecheck | 0 | 型エラー0 |
| npm test | 0 | 25 files / 157 passed / 0 failed / 0 skipped |
| npm run build | 0 | ソースからdist再生成 |
| npm run server:build | 0 | 型検査＋backend bundle |
| npm run generate:catalog -- --check | 0 | actual canonical 0件、正規生成一致 |
| npm run test:e2e | 0 | 既存2＋server-mode3 = 5 passed / 0 failed / 0 skipped |
| node --test tests/content-studio-legacy.test.js | 0 | 19 passed / 0 failed / 0 skipped |
| node tests/seattest.js p1 / e1 | 各0 | 各20 passed |
| node tests/regressiontest.js p1 / e1 | 各0 | 各476 passed |
| node tests/resulttest.js | 0 | 93 passed |
| node tests/loopbacktest.js | 0 | 103 passed |
| node tests/stage3test.js | 0 | 510 passed |
| node tests/lobbysimtest.js | 0 | 7 passed |
| npm audit --omit=dev | 0 | production vulnerabilities 0 |
| npm audit --json | 1 | 既存dev間接nanoid 3.3.17、high 1（後述） |
| git diff --check | 0 | 空白エラー0 |

root既存workflow相当は合計1705 passed、追加legacy19を含め1724 passed。ゲーム本体は無変更。必須試験をskip化・削除・期待値弱体化していない。

失敗経緯もPASSへ置き換えない:

- 初回npm ciは空き容量不足で2回exit 1。ユーザーが容量を確保した後の再実行exit 0。依存未導入時の未実行を成功と記録していない。
- publish-safetyの追加5ケースは修正前に5 failed（2026-09-05 09:35頃）、修正後は5 passed。
- 初回generate:catalog --checkはcheckout改行と生成改行の差でexit 1。正規generate:catalogを実行後exit 0。内容は空catalogのまま、意味上の変更なし。
- 追加mobile初回は3 failed。IndexedDB fixture調整後、server gatewayのnative fetch呼出し不具合を再現・修正し、最終全5 passed。途中失敗を実GitHub上の事故とは扱わない。
- fixtureの並行PR作成がGitHubと異なり非atomicだった点を修正し、一意性assertionは維持した。

## Mobile証拠

Android 13相当UA、portrait/touch Chromium、DPR 2.625、幅360/390/412 CSS px、高さ850（従来E2Eは412×915）。ソフトキーボード相当の領域縮小は高さ430へのviewport変更で確認。実Android OSのキーボード・アドレスバー・共有UIの試験ではない。

- 全対象選択数とhamulton画像、公開一覧失敗→再試行
- 差分確認checkbox、48px以上のPR主要ボタン、二重clickで送信1回
- PR成功応答喪失→reload、CI queued/failure、準備TTL410、再認証、merge済み/配備待ち/配備済み
- 長い名前の下書き、長いbranchの折返し、横overflowなし、短いviewportで主要ボタン到達
- ダミーCSRFがoutbox/localStorage/sessionStorageへ保存されない

server-mode E2Eは実frontendとモックAPI応答の組合せ。backendのGitHub応答喪失等は別のrepository fixture試験で証明する。実GitHub Appの故障注入や本番mergeは実施しない。

ローカル証拠: tools/content-studio/test-results/server-safety/**/review-{width}.png、ci-failure-{width}.png、short-viewport-{width}.png、trace.zip。CIでは同名artifact content-studio-playwright-reportへ成功時も保存（7日）。外部監査時に必要なartifactを保存すること。

## 保護対象と残件

index.html、assets/characters等の画像、戦闘計算・能力・技・表示設定、Firebase/database.rules、Stage Studio、root Service Workerは変更していない。無関係なworktree/branch/PR、正本の既存作業を変更していない。認証情報を読んで出力する検査は行わず、secret検査はダミー値のみ。新依存なし。package.json変更は2本目のmobile E2E入口のみ。

- P1 外部設定未完: actualのmaster保護なし。server/READMEのstrict必須チェック・管理者適用・no bypass・GitHub App読み取り権限を人間が設定し、外部監査で再確認するまで自動merge停止。この制限を最終完成とは扱わない。
- P1 外部監査待ち: このPRはDraftで提出し、自分ではmergeしない。MERGE GO前に次Phaseを積まない。
- P2 dev依存backlog: nanoid 3.3.17は開始baseとlock一致。npm auditはGHSA-2v37-7h3g-55p8（custom generator size=0の無限loop）をhigh報告。今回新規導入ではなくproduction auditは0。受入条件: 別PRでlockを安全更新し、Studio全試験・dist同期・audit再確認。一般的な依存更新を今回へ混ぜない。
- P2 実Android確認: 360/390/412相当端末で実IME、ブラウザ可視領域変動、PWA再開/共有・容量不足を手動確認する。エミュレーション結果を実機済みとしない。
- P2 後続Phase: 実バトルへのmotion再生。既存計算・ONLINE protocolを維持する受入条件を別途確定。このPRでは実装しない。
- P3 運用: stable SESSION_SECRETの安全保管、サイトデータ消去に備えた下書きバックアップ、CI evidenceの保存期間。意図的な管理者保護解除や署名鍵交換、サイトデータ消去後まで復旧を保証しない。

## 変更ファイル一覧

- .github/workflows/content-studio.yml
- docs/content-studio-design.md
- docs/tasks/content-studio-completion-p1.md
- tests/content-studio-legacy.test.js
- tools/content-studio/README.md
- tools/content-studio/dist/assets/index-BQLMZiql.css
- tools/content-studio/dist/assets/index-C_8sKP-p.js
- tools/content-studio/dist/assets/index-CaQc1Jhg.css
- tools/content-studio/dist/assets/index-DZ9Hs5v0.js
- tools/content-studio/dist/assets/motion.worker-B3uiWlad.js
- tools/content-studio/dist/assets/motion.worker-C3DDXtu2.js
- tools/content-studio/dist/index.html
- tools/content-studio/package.json
- tools/content-studio/scripts/generate-game-content.ts
- tools/content-studio/server/README.md
- tools/content-studio/server/app.ts
- tools/content-studio/server/ci-policy.ts
- tools/content-studio/server/config.ts
- tools/content-studio/server/github-api.ts
- tools/content-studio/server/repository-service.ts
- tools/content-studio/server/snapshot.ts
- tools/content-studio/server/types.ts
- tools/content-studio/server/validation.ts
- tools/content-studio/src/App.tsx
- tools/content-studio/src/app/use-studio-controller.ts
- tools/content-studio/src/domain/bounded-json.ts
- tools/content-studio/src/domain/legacy-characters.ts
- tools/content-studio/src/domain/publish-limits.ts
- tools/content-studio/src/domain/schemas.ts
- tools/content-studio/src/domain/security.ts
- tools/content-studio/src/domain/types.ts
- tools/content-studio/src/game/published-content.ts
- tools/content-studio/src/generation/artifacts.ts
- tools/content-studio/src/generation/catalog.ts
- tools/content-studio/src/github/server-gateway.ts
- tools/content-studio/src/storage/db.ts
- tools/content-studio/src/styles.css
- tools/content-studio/tests/e2e/android-flow.spec.ts
- tools/content-studio/tests/e2e/publish-safety.server.ts
- tools/content-studio/tests/e2e/serve-server-mode.mjs
- tools/content-studio/tests/e2e/server-safety.config.ts
- tools/content-studio/tests/integration/generator-script.test.ts
- tools/content-studio/tests/unit/ci-gate.test.ts
- tools/content-studio/tests/unit/publish-limits.test.ts
- tools/content-studio/tests/unit/publish-safety.test.ts
- tools/content-studio/tests/unit/repository-fake.ts
- tools/content-studio/tests/unit/server-fixtures.ts
- tools/content-studio/tests/unit/server-repository.test.ts
- tools/content-studio/tests/unit/server-validation.test.ts
- tools/content-studio/tests/unit/snapshot-recovery.test.ts
- tools/content-studio/vite.config.ts
