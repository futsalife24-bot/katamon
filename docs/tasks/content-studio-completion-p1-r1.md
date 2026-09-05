# Content Studio Phase 1-R1 — PR #386 再監査記録

設計・安全性判断: Astra。外部独立監査のHOLDに対する実装修正。MERGE GO、Studio全体の完成、Phase 2開始を意味しない。

## Actualと保全

- 対象: futsalife24-bot/katamon、Draft PR [#386](https://github.com/futsalife24-bot/katamon/pull/386)。
- 開始master/base/merge-base: 9c4e8373f6f036fe07e4666cc6d435836920f8af。作業中の再取得でも同じ。
- 監査対象の旧head: 53cfdf24fde1b7128f6daf24ccb65f9a062e0e6b。
- branch: codex/feat/content-studio-completion-p1-publish-safety。
- 既存専用worktreeで修正。開始時git status/worktree一覧、PR head/base/CI、AGENTSを再確認。正本の別作業・未追跡ファイル・他worktreeを保護。
- 旧headのローカル復帰参照: backup/content-studio-p1-before-r1-53cfdf2。PR全体を1 commitに整理し、確認したremote headを条件にforce-with-leaseで同じDraft PRだけ更新する。確定head/終了actual/CI URLはPR本文へ記録する。
- read-only API再確認: master protected=false、rulesets=[]。管理者設定変更、masterへの試験書き込み、本番障害注入、試験用実GitHub PR作成、mergeは実施しない。

## 指摘と修正前の再現

| 指摘 | 重要度・監査時の根拠 | 修正前の実行結果 |
| --- | --- | --- |
| R1 画像復元が公開状態を消す | P1、外部監査は静的確認 | 実frontend＋実ローカルbackendで画面から通常PNG取込→5モーション生成→準備/承認/PR→reload/再開→復元待ち。publish-completeが消えて失敗。Playwright exit 1、1 failed |
| R2 追加必須check-runをstatusだけで探す | P2、設定依存。保護未設定の本番事故とはしていない | CI抽出fixtureでStudio2件＋test＋mobile-e2e成功、statuses空。expected success / received queued。Vitest exit 1、対象1 failed（23件は名前filter対象外） |
| R3 無変更prepareが別操作になる | P2、createdAtを含む再生成経路 | 同じ画像付きブラウザ試験で時間を置いてprepare/PRを再実行。fixture PR数が1→2、branch/headも増えた。Playwright exit 1、1 failed |

修正前の入口: npx playwright test --config tests/e2e/local-backend.config.ts（初期の画像付き再現1件）、同入口にREPRO_R3=1を与えた再試行再現、npx vitest run tests/unit/ci-gate.test.ts -t 'R2 accepts'。最終テストでは一時的なREPRO分岐を通し試験へ統合した。

## R1: 復元と編集の分離

controllerのrebuildImage/rebuildHitImageは復元フラグを受け、プレビュー復元ではDraftや生成済み画像を更新しない。persistDraftStateはpublicationInputKeyで内容を比較し、本当の変更のみbundle/prepared/PR表示を無効にする。時刻・画面移動・プレビュー操作は内容identityに含めない。元画像と被弾画像のSHA256もDraftに保存し、同名・同容量の差し替えを区別する。

非同期処理は下書きIDと内容epoch、AbortSignalを照合する。下書き切替・後続編集・新規取込が先に起きたら古い結果を適用しない。復旧中のprepare/openDraftの待機後も照合する。プレビュー失敗はエラーを出して既存PR・outbox・生成物を保持する。送信前とCI待機後には現在内容と凍結bundleの対応を再確認する。

保存schemaの破壊的移行はない。追加情報はoptional。旧outboxに照合用inputKeyがない場合、対応を推測して再開せずエラーにし、保存済みPRリンク・下書き・outbox・画像を残す。この旧形式の自動対応付けは未提供。再準備は現在の内容に対する明示操作となる。

## R2: 必須チェックと実行元

ci-policy.requiredChecksFromProtectionはcontext/app IDを保持。GitHub APIのnull（非固定）と-1、legacy contextsを読み、欠落app_idや同名の相反設定は停止する。nullの契約は[公式protection API応答例](https://docs.github.com/en/rest/branches/branch-protection)に基づく。

GitHubClient.getChecksはStudio必須2ジョブを引き続きexact workflow/run/attempt/head/appで確認。追加GHA checkもcheck suiteからworkflowを特定し、最新run/attemptのjobとcheck-run IDを照合する。再実行開始時の古い成功、別SHA、実行元違い、欠落、実行中、failure/cancel/timeout/skipped/neutralを成功にしない。全ページを取得し、上限や曖昧な同名は停止する。

非固定contextでcheck/statusが同名なら両方の成功が必要。app固定contextにstatusが併存する場合、status APIだけではapp IDを証明できないためrequired_checks_unsupportedを返す。複数workflow/実行元、不正・未対応設定も終わらないqueuedにせず具体的エラー。root test/mobile-e2eを必須から外さない。旧head 53cfdf2の実GitHub APIをGETだけで読み、新実装へStudio2件＋root test/mobile-e2eを要求する試験もsuccess（exit 0）。これは提案する必須設定での読取照合であり、本番保護が有効という意味ではない。保護取得不能ではmerge APIを呼ばない。直前master GETを原子的な競合防止とは説明しない。

## R3: 同じ操作と最新baseへの移行

validateAndBuildはinputKeyが一致する凍結bundleを再利用する。時刻だけでcreatedAt、assetVersionHash、bundleId、画像hash、branchを変えない。

「最新masterで差分を作り直す」は元PRを残した後継操作。revalidationは元branch/head/base/operation digest＋target baseを含む。backendはactor/repoに結び付いたHMAC、元PR状態、single parent、全treeと差分を再検証する。旧baseと新baseの対象canonicalのblob SHAが違えば競合として停止する。対象外キャラは新baseのcanonical集合から再構成する。

後継identityにはこの関係を含め、同じ移行の再試行・backend再起動でも重複しない。画像と生成時刻は凍結したまま。旧操作と後継操作を別outbox行に残し、元PRへのリンクを表示する。新しい差分承認と新headのCIが必要。旧PRをcloseせず、branchをforce pushしない。対象競合で停止した場合も旧PR表示を維持する。

## 実行検証と証拠

対象は上記baseに対する本PRの作業tree。最終commit SHAはPR本文に記録する。Windows/Node 24のローカル結果と、Ubuntu/Node 22のCI結果を分ける。

| コマンド | exit | 結果 |
| --- | --- | --- |
| npm run typecheck | 0 | TypeScript成功 |
| npm test | 0 | 194 passed / 0 failed / 0 skipped、26 files |
| npm run build | 0 | Vite production build、dist再生成 |
| npm run server:build | 0 | backend bundle成功 |
| npm run generate:catalog -- --check | 0 | actual canonical 0件の生成物一致 |
| root seat p1/e1 | 0 / 0 | 20 / 20 passed |
| root regression p1/e1 | 0 / 0 | 476 / 476 passed |
| root result / loopback / stage3 / lobby | 全0 | 93 / 103 / 510 / 7 passed |
| node --test tests/content-studio-legacy.test.js | 0 | 19 passed / 0 failed / 0 skipped |
| npm run test:e2e | 0（前回22件） | 保存順序追加後は全23件。確定headでの最終結果はPR本文参照 |
| git diff --check | 0 | 空白エラーなし |

rootの実コマンドはnode tests/seattest.js p1/e1、node tests/regressiontest.js p1/e1、node tests/resulttest.js、node tests/loopbacktest.js、node tests/stage3test.js、node tests/lobbysimtest.js（p1/e1は各々別実行）。

root合計1724 passed（既存1705＋legacy19）。R2の47件、snapshot/recovery28件、入力identity7件を含む。対処中に後継操作E2Eが一度timeoutしたのは、試験が非同期prepare完了前に承認を押していたため。再準備完了・承認リセットを待つように修正し、同じ成功条件で再実行した。また、正式E2E初回は通常画像直後の被弾画像取込で通常画像処理までepoch失効する今回の回帰を再現した（exit 1、1 failed/1 passed、後続suite未実行）。元画像処理の完了を待って被弾画像を取り込む修正により、既存テストの操作・期待値を変えず成功を確認。さらに非GHA追加checkのqueued/started_at=nullで古いsuccessを拾う境界をfixtureで再現（exit 1、1 failed、46件はfilter対象外）。実行ID順で最新checkを選ぶよう修正して回帰試験へ追加。重要テストのskip化、チェック削除、期待値の弱体化は行っていない。

ブラウザの区分:

- 従来android-flow: buildした画面で2件。
- publish-safety.server: API応答を制御する画面試験3件。実backendの証明とは区別する。
- image-recovery.backend: 実frontend（Vite dev＋実Worker）＋createApiHandler/SessionStore/RepositoryService/validation/snapshot。GitHub境界だけメモリfixture。全/apiの固定応答ではない。セッションは試験サーバーが同じactorのcookieを発行し、OAuthプロバイダ自体の試験ではない。
- 360/390/412 CSS px、portrait/touch Chromium、Android13相当UA。通常画像・被弾画像、2.5秒遅延、元画像失敗（360/412）・被弾画像失敗（390）、reload/再認証、復元完了後のbundle/画像hash/branch/head/差分/PR保持、後続編集無効化、別下書きへの遅い結果不適用、後継操作/競合/旧outbox保全を確認。
- 長い名前、height430px、横overflowなし、主要操作48px以上・固定UIに隠れない状態を検査。実Android端末・実IMEの確認ではない。
- 各画像復旧testのrestored-<scenario>-<width>.png、successor.png、trace.zipをtest-results/local-backendへ出力。CI artifact content-studio-playwright-reportに保存。ローカル証拠は.phase1-evidenceに保管しcommitしない。

## 変更範囲と残件

R1-R3のcontroller、App、domain/types/publication-input、gateway、server ci-policy/github-api/repository-service/types/validation、tests、package.jsonのE2E入口、READMEと監査記録、sourceから再生成したdist。依存追加・lock更新なし。snapshot再構成・容量上限・参照/ハッシュ検査・既存画像非上書き条件は維持する。

index.html、既存画像、能力・技・ID、Gear/ONLINE/戦闘/Firebase/Stage Studio/Service Worker実装には変更を加えない。ダミー値による秘密情報混入試験を維持し、本物のsecretを出力・commitしない。

外部設定: classic protectionのstrict必須CI、Studio2件のGHA実行元固定、既存root必須check/status、管理者への適用・bypassなし・force/delete禁止、Appの保護読取権限。現状未設定なので自動mergeは停止する。設定変更は人間が行い、その後外部監査が必要。

実機残件: 実Androidメモリ圧迫/IME/復帰・長時間中断。後続Phaseは初回Phase 1記録のbacklogを継承し、このPRへ機能追加しない。旧inputKeyなしoutboxの自動対応付けと、rulesetだけの保護確認は未対応だが、保存物とPR確認導線を保持して明示停止する。

### CIで見つかった試験の待機不足

中間head 378c624のContent Studio CIで、新規下書きのIndexedDB保存・画面mountを待たずpage.evaluateから画像入力へアクセスする追加helperの競合が再現した。PR run 33940029244は実backend suite 7 failed/10 passed、push run 33940026831は4 failed/13 passed（どちらも既存2＋3件は成功、exit 1）。画像入力DOMのattached状態を待つ修正を追加。実装の期待結果は弱めず、同じ画像操作・復旧・差分・重複防止を再検証する。中間headと失敗runも証拠として残す。

自動保存を60秒へ遅延させる実backendブラウザ試験も追加し、公開直後reloadで下書きが古く再開不能になる経路を再現（修正前exit 1、1 failed）。prepareChangeはautosave.flushと保存済みDraft/inputKeyの一致確認を終えてからoutboxを保存する。保存失敗や待機中の編集では公開準備を止める。同じ遅延条件で修正後exit 0、1 passedを確認。全23件の最終実行・CI結果はPR本文に記録する。
