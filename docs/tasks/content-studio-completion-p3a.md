# Completion Phase 3-A — 公開済みキャラクターの安全な再編集

開始base a8842d27952be24796f0ff54c4521c879fc659ce。新しい専用branch/worktree。実装GOのみ、Draft PRで外部監査待ち、merge禁止。

## 固定する契約

- 情報編集は元canonicalの画像/5motion/metadata参照とbytesを維持する。無変更はbackendもno-opとして書込0件。
- 実serverの読取は認証済み固定repositoryの最新commitを固定し、canonical blobと全参照を検証する。元revisionを本人/repo/slugへ結び、公開直前に同じ対象の変更を独立拒否する。他キャラだけの変更は最新snapshotから保全する。
- 編集チェックポイントは背景消去/切抜き後・配置前の加工済み基準PNGを開始地点にする。透明画素RGBを0にしてCanvasからPNGを再出力し、撮影原画/EXIF/元ファイル名/過去操作を公開しない。通常+任意被弾入力、配置/反転/寸法、向き/接地点/砲口、5強度/実使用parameters、形式とgenerator version、画像hashをstrict canonicalの専用項目で保存する。別の汎用編集履歴は作らない。
- 情報編集と画像・動作の変更を分離。変更のないPNGは再encodeしない。同じimmutable directoryの契約を維持するため動作変更時は新directoryへ未変更bytesを複製する場合がある。JSON内参照は新directoryへ更新する。変わったclipだけを生成する。
- 旧レシピなしは公開生成物を保持した情報編集だけ可能。再生成は不足入力の再選択または公開画像を新しい加工済み元として使う明示操作が必要。旧renderingや基準点を推測して復元済みにしない。
- 読取/検証完了後、draftと必要blob/metaを単一IDB transactionで保存。失敗・中止・切替は現在のdraftを保持。import元revision/ファイルを検証し、承認/outboxは復元元の権限として信頼しない。
- 既存18体はlegacyTargetId/gameID/保存slugと非motion設定を固定。特殊技の読取値を勝手に必殺なしへ変換しない。
- 上限6MiB/file・16MiB/files・24MiB Base64 request・32filesを維持。加工済み編集入力の寸法/読込/処理予約も有限。容量不足では保持して停止し、品質を黙って下げない。

## 検証

実frontend+local backend、GitHub境界だけfixture。A→B→空context→A無変更/情報編集/動作編集→再読取。競合/旧形式/legacy18/破損/容量/保存/切替を追加する。360/390/412 touch、短いviewport、長い名前。全既存要求コマンド、root M1/乱数不変、CIのHTML/添付JSON/連続画像を保存。

## 境界

ゲーム/index/runtime/Rules/root SW/本番設定/認証情報/他PR変更なし。mock明示を維持。Phase 3-B/3-C・旧outbox全面移行・本番完走は未着手。

## 実装と安全性の根拠

|領域|優先度 / 確認方法|実装・受入証拠|
|---|---|---|
|公開正本と同一対象競合|P1 / fixture・実backend|repository-service.readPublishedCharacter / validateSourceRevision。actor/repo/slug/base/canonical blobへ署名を結び、更新直前の対象blobを比較。published-edit.server.test.ts のA→B→A・並行A・偽証明・再起動回復試験。|
|不要な公開・画像保持|P1 / 実ブラウザ|buildInformationBundleとbackend no_changes。全画像/metadataのパスとhashを比較。射撃強度変更ではmain thread PNG encodeが1回（射撃sheet寸法）だけで、他4枚のbytesは不変。|
|公開入力の安全性|P1 / unit・生成器ブラウザ|editing-checkpoint strict schema、sanitizeEditingInput、validateCheckpointPng。加工済み入力は1600pxまで、RGBA透明RGBをゼロ化。CRC/chunk/有限inflate/圧縮末尾/画像hashを照合。秘密形式の試験値はdummyだけ。|
|保存の原子性|P1 / 修正前失敗→修正後成功|published-storage.test.tsで2枚目のblob putを例外化。初回はdraftが残り1失敗/1成功。transaction.abortを明示した後は2成功。公開読込、5生成物保存、import、duplicateを整合単位で保存する。|
|未完了デコード|P1 / fake timer・実ブラウザ|acquirePublishedBitmap、同時2件・予約64MiB。timeout後も実decode終端まで予約保持、遅いbitmapをclose。巨大寸法/サイズ詐称は開始前拒否。64MiBは管理対象RGBAの予算でありブラウザ全RAM保証ではない。|
|旧形式・既存18体|P1 / unit・実ブラウザ|recipeなし情報編集・生成物維持・明示採用。全18対象のrevision/identityと非motion設定拒否。sourceFacesLeftのみmotion方向として再生成時の変更可、gameの既存静止設定には反映しない。|
|旧クライアント|P1 / schema・backend|新editingはoptional strict拡張。未知項目を許容しない旧clientは新canonicalを受け付けない。旧canonicalもbackendは既存レコード変更時にsourceRevisionを要求する。|
|部分取得・切替|P1 / 実backendブラウザ|missing/hash/保存quota/遅い結果をfixture化。正常な既存draftと後続編集を保持。公開版は検証・一括保存後に初めて表示する。|
|UIとmock境界|P2 / 3幅ブラウザ|公開版→下書き再開を区別。mockの模擬結果表示、server正本表示、長い名前・高さ430px・360/390/412 portrait/touch。公開前に加工済み編集入力の送信を表示。|

編集データはcanonical.editingと同じimmutable directoryのedit-source.png/edit-hit.pngに限定し、実ゲームの互換catalogへeditingを出力しない。別編集JSONは増やさず、motion JSON専用検査を流用しない。情報編集では元のgeneratorVersion・createdAt・全assetVersionを維持する。動作変更時のみ0.6.0の新directoryを生成し、未変更PNGはbytesを複製する。新版のcatalog generatorVersionへの変更だけではbackendはPRを作らない。

端末内バックアップは原画と公開baselineの両方を含み得るため最大64MiBとした。公開ZIP/送信の6/16/24MiB・32件は変更なし。importは新draftとして内容を検証し、公開元revisionもbackendで再検証する。差分承認やoutboxをimport元から信頼しない。既存outboxは消去せず、旧inputKeyなしの推測対応付けも行わない。

## 実行記録（コミット前ローカル）

正本baseはa8842d27952be24796f0ff54c4521c879fc659ce。作業中ソースでの結果と、確定headのCI結果は分けて報告する。ログは専用worktreeの `.p3a-evidence/` に保持し、CIの独立証拠と混同しない。

- 更新元証明の修正前試験はpublished_revision_requiredを期待して失敗。修正後、同対象競合・他対象保全・no-opを含むserver試験を通す。
- 初回全unitは既存の正常A更新fixtureに新revisionがなく1件失敗。実際の読取でrevisionを得るようfixtureを更新し、B保全のassertは維持。
- 初回API固定置換画面試験は新しいpublished-list経路がfixture未実装で3件失敗。既存画面試験のfixtureのみ追加し、重要assertを維持。これは実frontend/backend通し試験とは別。
- 新規backup E2E初回はAI提案入力欄を誤選択して失敗。実「JSON読込」ボタンのfilechooserを使い、同じ公開snapshot・5clip・no-opのassertで成功。
- 追加PNG末尾検査の最初の型検査はNode型定義のinfo戻り値不足で失敗。実行結果型をbuffer/bytesWrittenだけに限定して修正。依存更新なし。
- generate:catalog -- --check初回は0.5→0.6のgeneratorVersionで不一致。正規generate:catalogを実行し再検査。キャラクター実データ追加なし。
- Windowsの生成HTMLにCRLFが残る場合はLFへ正規化してgit diff --checkを確認する。生成内容はLinux CIの再buildとも照合する。source/distの意味上の差と作業tree改行を区別する。

### 独立確認する証拠

Content Studio verificationの既存必須2job名・PR/push起動を維持。Android jobは実frontend/backend試験と実drawUnit/M1試験を実行し、`content-studio-playwright-report` artifactへStudio HTML report・添付JSON・PNG・失敗trace、root HTML report・連続フレーム画像を保存する。実frontend/backendのlocal-backend設定はtrace:onで成功時もtraceを保存する。通常PWAと他の既存試験はretain-on-failureであり、成功時の証拠はHTML/JSON/画像。保存期間7日。

`checkpoint.backend.ts` は5clip×3強度×128/256/384/512の60組を実生成→加工済みPNG読戻し→再生成し、画像hash・rendering・parametersを一致確認。左右原画、編集反転、padding/scale/offset、手動ground/muzzle、任意hitを含む。

`published-edit.backend.ts` は3幅でA生成・fixture公開→B→空context→A無変更→情報編集→保存/reload→更新→射撃だけ再生成→再公開→空context再編集。390pxではバックアップexport/import→backend no-opも確認。fixtureはGitHub境界だけで、認証fixture routeはテストサーバー内のみ。本番GitHubへの試験PR/試験キャラ/障害注入はない。

## 維持する未完了事項

本番backend/OAuth完走、Firebase登録契約、保護設定、旧inputKeyなしoutbox、PWA/offline/update/保存の広い異常系、実Android/IME/メモリ圧迫/長時間復帰、既存WebKit skip・地形初期化・曜日迷宮2タブ、依存監査警告、初回監査backlogを未完了のまま維持。今回のChromium device emulationは実Android/実IME試験ではない。Phase 3-B/3-C実装・本番設定変更・mergeは実行しない。

### 最終ソースのローカル結果

|コマンド|exit|結果|
|---|---:|---|
|Studio npm ci / root npm ci|0|既存lockから導入。依存追加・更新なし。|
|Studio npm run typecheck|0|型検査成功|
|Studio npm test|0|31ファイル・266 passed / 0 failed / 0 skipped|
|Studio npm run server:build|0|backend bundle生成|
|Studio npm run generate:catalog -- --check|0|正規生成物一致|
|node --test tests/content-studio-motion.test.js|0|31 passed / 0 failed / 0 skipped|
|node tests/content-studio-motion-game.test.js|0|同seedの1v1/2v2比較2組とevent/reset検査、戦闘・乱数不変|
|node --test tests/content-studio-legacy.test.js|0|19 passed / 0 failed / 0 skipped（18体＋一覧照合）|
|root npm test|0|68工程成功。seat/regression/result/loopback/stage3/lobby・ONLINE/Gear・APP_SHELL/cacheを含む。異種runnerの件数を恣意的に単一総数へ合算しない。|
|root Playwright content-studio-motion / Android Chromium|0|3幅3 passed / 0 failed / 0 skipped。M1の同じPlayer/Map/state/cache世代を保ち、失敗後の実移動と単発射撃を確認。|
|root Playwright game-shell / stage-studio / Android Chromium|0|14 passed / 0 failed / 0 skipped。実機ではない。|

途中の全E2E実行で、25件成功後、最後の試験中のローカルソース編集と画面の再読込が重なり1件失敗した。これは成功として数えず、ソースを固定して全コマンドを再実行する。新規skip・assert削除による回避はしていない。

最終GitHub actual: 開始/コミット前masterはa8842d27952be24796f0ff54c4521c879fc659ce、protected:false、rulesets:[]。管理設定は変更していない。旧Phase 1/2 backup refs、既存worktree、正本側の未コミット変更・未追跡ファイルを保持した。新しく作るGitHub PRはこの実装Draft PRだけ。

最終のソース固定再実行: Studio `npm run test:e2e` exit 0、通常PWA 2 passed、API固定画面fixture 3 passed、実frontend/backend 26 passed（計31、failed/skippedとも0）。最終 `npm run build` exit 0。3幅の画像を目視し、長い名称・公開版情報・差分承認・PR結果・固定footerの操作を確認した。local-backendの成功traceも保存する。最終結果は `.p3a-evidence/e2e-release.log`、`unit-release.log`、`root-motion-release.log` 等。確定headとCI run/結果はDraft PR本文・監査コメントへ追記する。

一覧はserverでもcanonicalごとの失敗件数を返し、部分失敗と正常な0件を分離する。基準commit自体の取得不能は全体エラーとして残す。選択キャラの編集読取は部分成功にせず、全参照と全体snapshotの検査が完了しなければ保存しない。

## 外部監査修正 Phase 3-A-R1（E1 / E2、HOLD・再監査用）

### actual と修正前の実行証拠

開始・push前 master/base/merge-base は `a8842d27952be24796f0ff54c4521c879fc659ce`、監査headは `0ca0012aba7992a2e4cbcd3d0b74d0873c9dfd10`。同じ専用worktree / Draft PR #388で修正。旧headの復帰参照 `backup/content-studio-p3a-before-r1-0ca0012` を保持する。最終head/tree/CIはPR本文に記録する。mergeしない。

E1/P2を実画面・実PNG生成で再現した。新規下書きはscale 0.86→0.5をApplyせず生成し、全blob SHAが不変のまま旧5クリップが生成成功扱いになった。公開済み再編集でも同じ停止条件のassertが失敗した。後者は監査headのGit archiveを専用の一時fixtureへ展開し、試験ポート4187/cacheだけを変更した。controller blob `9ca0f46d3e09b27fa0f83d3d16bda9f36bf39744`、batch blob `d18e24eec1fa3224c896ac78a30db6f488ce587c` は監査headと一致。実frontend/API/backend、GitHub境界のみメモリfixture。抽出関数だけの再現ではない。

E2/P2も実UI削除・実IndexedDBで再現。draft/blob削除後、editing-inputと5 motion metadataとsprite metadataの7項目が残った。実ディスク容量の測定結果とは呼ばない。

修正前3ケースのJSON・画像は `tools/content-studio/tests/fixtures/p3a-r1-before/`。新しいCIの実行結果と混同しないよう `historical pre-fix observation` / `PRE-FIX-local` と明示し、実行後artifactにも添付する。完全traceはローカル `.p3a-evidence/r1-before-reproduced/` と `.p3a-evidence/r1-baseline/` に保持。JSONにtrace SHA-256を記録した。これらのローカルtraceをGitHubから取得可能とは報告しない。

試験作成中の初回E1はスライダーではなくoutput要素を指定して失敗したため、製品の再現には数えていない。以降、旧step-nav-validate、button以外の同名class、Fieldのselectラベル指定を修正した。途中の同じ誤指定による待機を中止した実行もある。新規のimport単体fixtureで整数paddingに0.1を与えた1失敗は有効値へ直した。重要assert削除・skip追加による回避ではない。元ログは `.p3a-evidence/r1-*.log` に残した。

### E1の契約と実装

- `domain/generation-input.ts` の `imageInputKey` と下書きの任意 `appliedImageInputKey` で、編集UIの現在値と最後に画像へ反映できた値を分離する。旧下書きで対応情報がない場合は未確認とし、推測して適用済みにしない。
- `rebuildImage` のApply開始時に適用済み状態を外し、必要な画像書込をすべて終えてから対応キーを更新する。失敗時は公開・生成へ進めない。プレビュー復元はこの状態を書き換えない。
- `persistDraftState` は実入力が変わったclipだけを無効化する。名前/説明/表示用zoom/tool変更は画像を無効化しない。射撃強度だけなら射撃だけを対象にする。既存PNGは消去しない。
- `motionInputKeys` は実際のnormal/hit RGBA、寸法、配置、向き、接地/砲口、clip定義、実使用parameters、generator versionをhash化する。時刻を含めない。`generateMotionBatch` はこのキーが一致するclipだけreuseする。入力対応情報はローカルappMetaへ保存し、複製/export/import/reloadで保持する。公開metadataやゲーム通信へ混ぜない。
- 公開チェックポイントは既にschema/hash/参照を検証した加工済み入力を基準にする。同じ入力画像・操作履歴なし・同じgenerator versionの場合だけ、元レシピの値から元clip用キーを構成できる。現在の変更値から古いclipのキーを捏造しない。公開再編集の射撃だけ変更で他4クリップのPNG bytesとencode回数を従来試験でも確認した。
- `createEditingInput` も全clipの実入力キーを独立に照合してからチェックポイントを書く。staleなPNGへ新しい配置だけを記録しない。
- Generate、Validate、公開準備、モーションZIP/metadata出力に停止条件を接続。公開画面に既存のValidate処理を呼ぶ入口を明示。未適用の設定をApplyへ戻す案内を表示する。下書きバックアップは未適用状態もそのまま保存できる。
- 情報編集/no-opの経路は既存canonical・画像・motion metadataを保持する。公開チェックポイントからreuseなしで実生成した5PNGのSHA-256とrendering基準が元の公開PNG/metadataと一致することをブラウザで照合した。

### E2の所有・依存・削除契約

- `DRAFT_META_SUFFIXES` に所有キーを列挙：published-snapshot、editing-input、motion-inputs、sprite-metadata、motion:<5 clip>:metadata。draftId＋このsuffixだけを削除する。別下書き・無関係なキー・共通設定・historyは対象外。
- draft / blobs / appMeta / outboxを含む単一readwrite transactionで依存を照合し、所有データを削除する。途中の例外では明示abortし、成功扱いしない。
- 同じdraftIdのoutboxが一つでもあれば、復旧用公開操作と既存PRを保持するため削除を理由付きで拒否する。outbox/PRのclose、推測の結び付けや孤立データの一括掃除はしない。
- 削除成功時は `deleted-draft:<id> = true` という画像・名前・内容なしの最小マーカーだけをappMetaの別namespaceに残す。これは削除済み下書きの画像データではなく、別タブ/再読込後も遅延保存を拒否するための削除記録。exportしない。各保存経路は同じtransaction内でこのマーカーを照合する。
- 保存待ち画像hash、autosave、生成結果、公開snapshot、outbox書込と削除を直列化する。削除後のsaveDraft/putDraftBlob/setAppMeta/saveGeneratedMotions/savePublishedDraft/putOutboxで復活させない。削除拒否時にautosaveを取り消さず、削除成功後に現在の編集処理と保持参照を片付ける。
- 既存の孤立データは今回自動削除しない。現行の所有データと依存が分かる明示削除だけを対象とする。

### 検証結果（ローカル）

|実行|exit|結果|
|---|---:|---|
|npm run typecheck|0|型検査|
|npm test（Studio）|0|33 files、274 passed / 0 failed / 0 skipped|
|npm run build / server:build|0|ソースから生成、既存500kB chunk警告あり|
|npm run generate:catalog -- --check|0|canonical 0件の既存正規生成物と一致|
|npm run test:e2e|0|PWA 2 + API固定画面3 + 実frontend/backend32 = 37 passed / 0 failed / 0 skipped|
|root npm test|0|既存68工程。異種runnerの件数を単一総数に見せない|
|node --test tests/content-studio-motion.test.js|0|31 passed、failed/skipped 0|
|node --test tests/content-studio-legacy.test.js|0|19 passed、failed/skipped 0|
|node tests/content-studio-motion-game.test.js|0|1v1/2v2の同seed比較2組、イベント/reset、乱数不変|
|root motion / game-shell / stage-studio Chromium E2E|0|17 passed、failed/skipped 0（M1の3幅を含む）|

全E2E後の局所差分は、削除が拒否されたときにautosaveを取り消さず、成功後に画像参照を解放する順序修正と証拠添付。該当6 E2Eを再実行し、exit 0、6 passed / failed 0 / skipped 0。確定headの全関連CIも再確認し、ローカル実行とCI実行を区別してPR本文へ記録する。

360/390/412 CSS px、portrait/touch Chromium。未適用案内、Apply、保存/reload、公開再編集/backup、削除を実行し、PNGとJSONを保存。Applyボタン48px以上も検査。390px・高さ430pxで長い名前/未適用表示も撮影した。実Android/実IME/実メモリ圧迫の確認とは呼ばない。

### 取得可能なCI証拠

従来すでにuploadしていた4つのテスト結果ディレクトリだけを `tests/e2e/package-evidence.mjs` で整理する。全結果のJSON、HTML要点ページ、PNG、SHA-256付き全ファイルmanifestを独立したsummaryへ置く。元HTML/traceを内容hashで重複排除し、1part最大160 MiBのdetailsへ振り分ける。元reportを構成する対応パスもmanifestに残す。個別traceは該当partだけで開ける。元HTML report全体はmanifestのパスへ必要partを組み合わせれば復元できる。失敗/skipを除外しない。

summaryも160 MiB上限を検査。梱包が成功したときだけartifactをuploadするため、上限超過を成功扱いしない。artifact名にrun_attemptを付け、再実行時も前回の失敗証拠を上書きしない。要点 `content-studio-audit-summary-<attempt>` と詳細 `content-studio-evidence-<part>-<attempt>`。正確なbyte数とURLは確定headのCI完了後にPR本文へ記録する。

初回のCI変更要求は、自動承認レビューが秘密情報の根拠不足として拒否した。変更は実行されなかった。既存upload対象4ディレクトリ、workflowのsecrets参照なし、固定ダミーsession secret/メモリGitHub fixtureを読取照合し、対象を増やさない局所変更として再審査が通った。実秘密値を読み出したり拒否を迂回したりしていない。

### 保全・残件

index.html / shared runtime / sw.js / assets / generated / database.rules.json、既存18体の能力・技・ID・静止画像、戦闘/通信の差分なし。Phase 1のsnapshot/revision/CI/保護条件も変更しない。依存追加なし。Studio version/generator/checkpointは未リリースの同じPR内の修正なので0.6.0を維持し、distの内容hashだけを正規buildで更新する。Windows生成物のCRLFは同内容のLFへ揃え、git diff --checkを確認する。

他worktree、正本の既存未コミット変更、未追跡ファイル、backup refsを保持した。masterの保護未設定/Studio自動merge停止、本番backend/OAuth、Firebase Rules、旧inputKeyなしoutbox、PWA/offline/update/保存異常系、実Android/IME/メモリ圧迫/長時間復帰、既存WebKit skip・地形初期化・曜日迷宮2タブ・依存警告・初回監査backlogは未完了のまま。MERGE GO、全体COMPLETEを宣言しない。

### CI要点JSONの実取得検査で見つかった不備と修正

中間head `a23e05d24f5b2fd6e25f34503c009ab615f543d2` では関連6 CIジョブは成功した。しかしPR run `33977919461` の要点artifact（92,157,243 bytes）を実際にダウンロードし、core 84ファイルのhashを照合すると、結果JSONがHTML reporterのcleanupで消えていると分かった。機能試験成功と証拠出力不備を分けて記録する。このartifactを完成済み監査証拠として扱わない旨をPRコメントへ通知した。

JSON reporterをHTMLフォルダ外の既存 `test-results/local-backend-results.json` へ分離した。梱包では、実行済みHTMLがあるのにJSONが欠ける/壊れる場合をエラーにする。以前の出力フォルダがある場合も混ぜず拒否する。新しい汎用基盤や送信先は追加しない。小さな梱包回帰2件を追加し、単体試験は34 files / 276 passed / failed 0 / skipped 0。実backend E1/E2 6件も再実行し、生成された要点JSONの expected 6 / unexpected 0 / skipped 0 / flaky 0を実読した。ローカル要点97,808,538 bytes、詳細4分割で上限内。これはCI artifactサイズと区別する。

補助検証でWindowsの既定文字コード(cp932)や一時作業ディレクトリからの相対パス指定に誤りがあった実行は未成功として保持し、UTF-8/正しいパスで再実行した。中間headは `backup/content-studio-p3a-r1-a23e05d` にも保持。最終headの全関連CIとartifactは改めて取得・照合してPR本文へ残す。
