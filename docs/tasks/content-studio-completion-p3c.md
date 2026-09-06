# Content Studio Phase 3-C — 登録revisionへの対戦固定

開始base: `e51ff8a1d5d9fd086491f69914c5979a82eb6cb2`。実装開始GOのみ。merge・本番適用は未承認。

## 実装前の契約

- 登録revisionは時刻・Git由来情報を除いた正規化データのSHA-256。gameIdと保存slugは別の値として保持する。既存18体はindexの宣言を非実行で抽出し、canonicalは対応済みcatalog変換に成功したものだけを採用する。
- gameplay定義hashと描画asset hashを分離する。既存18体のcanonicalはモーション参照だけを追加する。編集画像・レシピ・端末情報を登録へ含めない。
- 旧ONLINE3/coop1のnamespaceとRulesを維持し、新ONLINE4/coop2は専用namespaceを使用する。利用者がモードを明示し、新形式の失敗を旧形式へ降格しない。
- 新部屋作成時にactive revisionを固定し、ready/開始時にもactive一致を確認する。開始後はそのrevisionを保持し、新activeで差し替えない。再戦は新しい開始境界として扱う。必要な定義は登録revision内に不変データとして保持する。
- reveal前はroom全体のrevisionだけ公開する。commitmentは席・round・revision・nonce・既存Gear bindingを拘束し、選択IDや個別hashをready情報へ露出しない。
- 通信のimmutable情報を検証済み定義から解決し、受信値と照合してから既存のmutable状態検証・反映へ渡す。描画asset失敗時の静止画fallbackと、定義不一致による停止を区別する。
- 通常ユーザーに登録簿writeを許可しない。publisherは固定repoのmerge済み正本・Pages対象SHAと内容を検証し、candidate同一性とactiveの期待世代を照合する。既定dry-run、本番の適用入口は明示的な環境承認を必要とする。
- 本番資格情報を使わず、demo専用project・loopbackの実RTDB EmulatorでRulesを試験する。Rulesと受信コードそれぞれの拒否を分けて証拠化する。

## 進捗と証拠

実装と下記ローカル検証を実施。確定commitのCI結果はDraft PRのチェックとartifactを正本とする。merge・本番適用は行わない。並行PR #362は一覧通信の表示変更であり、取込みや変更は行わない。

### 確定した接続境界

- 登録実体は `characterRegistry/revisions/<SHA256>`。RTDBがnullを削除するため、正規化JSONのpayloadとRules用の最小ID/hash indexを保存し、クライアントは両方の一致を検証する。activeはrevision・単調増加generation・merge元sourceShaを持つ。内容revisionへGit SHAや日時を含めない。
- `registeredRooms`（ONLINE4）、`registeredCoopRooms`（coop2）は旧namespaceから分離する。部屋作成と開始のwriteにactive照合を置き、GET後の競合もRules境界で拒否する。対戦中のキャラ/definitionHashとround差替えを禁止する。
- 読取は単一revisionを最大2MiB、HTTP入口では上限付きstreamと期限で制限する。必要キャラのasset検証は同時1件・最大6MiB/件、同じ要求を共有する。任意URLを読まず、旧revisionも同じ許可path/hash契約で解決する。Phase 2の画像展開64MiB管理は変更しない。
- `buildRegistrationCandidate`はゲームの既存宣言を非実行で読み、compatibility catalogで対応できた公開キャラを加える。backendの固定base再構成で登録candidateも差分とcommitへ含める。publisherはmerge済み固定repoから独立再生成し、ゲームPagesのHTML/runtime/candidate/参照bytesを照合する。
- publisherは既定dry-run。適用時は候補の不変性、active ETag/generation、Git ancestryを確認する。workflowは既定無効で、master上のコードだけを実行し、別途人間が設定するenvironment承認/WIFを必要とする。本番適用は本PRのCIやmergeだけでは開始しない。

### 実行中に確認した接続漏れ

- 人間2席の実協力戦開始snapshotは地形下端924だが、従来transport検証は936を要求していた。実ブラウザから採取した同じsnapshotについて、既存検証が拒否し924契約なら通ることを診断し、新coop2だけを実ゲームの924へ固定した。生成地形/物理/旧coop1の定数は変更していない。390px・実Emulatorの2人+AI開始は修正後成功。旧クライアントでこの地形問題が解消したとは扱わない。
- fresh reloadでは対戦shellができる前に履歴を検証する。認証と部屋revisionを確認済みのpending復旧候補にも登録snapshot検証を接続した。
- 復旧失敗時のローカル盤面退避には未配置キャラが含まれる。通信snapshot用hashを要求せずローカルで退避し、そのオブジェクトidentityをWeakSetで限定して復元する。受信JSONやoptionだけではこの例外へ入れない。ONLINEの空のページからの再読込・旧revision復旧は実Emulatorで成功。RTDBが省略する空配列も、検証済みと同じ正規化packetでリプレイする。

### 中間検証（確定headのCI証拠ではない）

全てbase `e51ff8a` からの作業treeで実行。本番書込なし。
- 登録/runtime/publisher unit: 23 passed / 0 failed / 0 skipped。
- demo projectの実RTDB/Auth Emulator: 48件成功。実際にロードされたRulesをrepository JSONと照合。通常ユーザーで許可/拒否を検証し、Adminはfixture準備とpublisher CASに限定した。
- Studio unit/integration: 39 files / 289 passed。初回のfixture不足、型検査のtest unknown型参照は中間失敗として別ログへ記録。修正後typecheck/build/server:build/generate:catalog --checkはexit 0。
- root全入口は最終 `npm test` exit 0。途中の旧BUILD_ID固定検査2件とprotocol固定文字列検査は、実際の対応contractの一致へ更新し、削除・skipで回避していない。
- 360/390/412px ONLINE1v1/2v2・単独人間のcoop・A/B更新は中間試験で成功。actual旧client対戦も単独再実行成功。最終は人間2席coop、旧revision reload、異常packetを含む15件すべて成功。初回/中間の失敗を最終成功へ置き換えない。

Java21は作業tree内の専用JDKを試験プロセスへ指定した。システムJavaは変更していない。firebase-toolsは実Emulator実行のためのdev依存で、本番runtime依存ではない。追加時の依存警告は未解消。

## 維持する残件

本番ホスト/OAuth/App/secret/保護/Rules・登録適用、旧inputKeyなしoutbox、PWA容量試験の不安定性、実Android/IME/メモリ圧迫/長時間復帰、既存skip・依存警告・初回監査backlogはこのPRの実行結果とは別に維持する。


## 最終ローカル検証と独立監査の境界

| 実行入口 | exit | 結果 |
| --- | --- | --- |
| Studio typecheck / build / server:build / generate:catalog -- --check | 各0 | 配布・生成整合 |
| Studio npm test | 0 | 39 files / 289 passed、fail/skip 0 |
| Studio npm run test:e2e | 0 | 2 + 3 + 32 = 37 passed、fail/skip 0 |
| Studio npm run test:production | 0 | 4 passed、fail/skip 0。本番build/preflight/CLI・実HTTPS・ダミーOAuth・2origin移行/PR復旧 |
| root npm test | 0 | 全入口成功。seat/regression/result/loopback/stage3/lobby・Gear/coop/復旧等。各入口の件数はCIログ |
| node --test motion + legacy | 0 | 50 passed、fail/skip 0 |
| motion-game | 0 | 1v1/2v2の2 seed比較、状態・乱数・通知/リセット保全 |
| 登録/runtime/publisher unit | 0 | 23 passed、fail/skip 0 |
| 実RTDB/Auth Emulator | 0 | 48 assertions、許可対照と401 Permission deniedを区別 |
| 登録ブラウザ | 0 | 15 passed、fail/skip/retry 0。360/390/412、portrait/touch Chromium |
| 既存ブラウザ3 spec | 0 | 16 passed、fail/skip/retry 0。drawUnit/M1全3幅、既存ONLINE描画・再接続・Gear ON/2v2 |
| APP_SHELL / cache契約 / diff --check | 各0 | scripts 47に漏れなし、Studio 0.8.0 / 本体 v2.0.176 |

ローカルは `e51ff8a` を基底にした未commit作業treeで実施。production/release.jsonのsourceShaもそのHEADを示すため、確定PR headの成果物とは区別する。確定headはCIで再ビルドする。既存全ブラウザのWebKit skip / progressive-precacheのflakyはCIで別途確認し、今回のChromium成功で解消扱いしない。

実生成器のPNGを `validateSubmission` → `RepositoryService.prepare/createPullRequest/mergePullRequest`（GitHub境界だけfixture）へ通し、CI queued時のmerge拒否、同じPR再試行時の1 commit/1 PRを検査した。そのcommitの登録candidateと生成candidateを照合し、実Emulatorのpublisherと対戦読込へ接続する。CIの `execution-contract.json` にはsource SHA / Rules hash / registryRevision / demo接続先 / publication結果 / retryを含める。

協力戦の通信再接続は同一ページでoffline→active更新→通信復帰を検査した。ONLINEはページreload後も旧revisionで復旧した。協力戦のページ自体を破棄した後のhost盤面復元は、この既存経路の試験では確認していない。実Android/IMEではない。

### 修正前・中間失敗を残す

- 初回Emulatorはsystem Java17非対応で失敗。専用local Java21へ切り替え、システム設定は変更していない。誤namespaceも実Rules読戻し試験が検出した。
- 実ブラウザのhost/guest開始で地形924/936差、ONLINE再開の事前snapshot/空配列、new-mode fetchのthis束縛を検出し、根拠を上記接続境界へ記録した。
- 15件の全体試験は一度10 passed / 5 failed。その後の5件試験は1 passed / 4 failed、2 passed / 3 failed。選択画面手順/未登録null表現のfixture修正、48px UI修正に加え、coop実受信順序の修正が必要だった。
- 実RTDB応答のpush key `-P0ptzQLyU0rXLVUZcZL` → `-P0ptzddLRiuh7zH7Zaz` はcode-point順で後続だが、localeCompareは逆順にした。未処理packetを永久に飛ばす経路を新coop2で修正し、旧coop1の比較は維持。通信復帰・不正inner revision停止を修正後に確認した。
- publication通しfixtureのWindows loaderはファイルURL化前に起動失敗（1 failed / 14 did not run）。14件をskip/passへ読み替えない。修正後の全体は15 passed。
- 中間ログ・一部traceは専用worktreeの `.registration-evidence/` に保持。ローカルだけの証拠をGitHubから取得済みとは呼ばない。最終CIはそのrun/attemptの成否・retryを別途保持する。

### 証拠と非変更確認

`package-evidence.mjs` のローカル検証はexit 0、要点104,169,867 bytes、詳細5分割、各part上限160MiB。registration/local-backend/productionの結果JSONを明示収録し、CIはsummaryと詳細を別artifactへアップロードする。CI側の実サイズはrunごとに確認する。

登録未配備の360px画面と協力戦開始412px画像を目視した。15件の状態/hash/assertによる検証とは区別する。登録の実データは18体、revision `261ae0db4cb5ab98117b0d6c0a176aae5e244a7e04d5e6076a54bbfb1175c2a1`、19,691 bytes。試験A/Bはfixtureのみで公開canonicalへ追加していない。

旧Rulesの6ルートはbaseと構造一致。既存画像・Phase 2 runtime・Gear定義の差分なし。ゲームの変更は登録読取/検証・通信binding・復旧/描画参照の境界に限定した。LF/CRLF警告は作業treeの変換警告であり、意味差分とは区別する。他worktree、既存backup参照、旧PRは変更・削除していない。
