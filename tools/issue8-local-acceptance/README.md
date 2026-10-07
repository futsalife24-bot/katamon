# カタモン：PR #404固定版のローカル受入準備

実機受入へ進む前の、**loopback専用の再利用キット**です。ゲーム本体・Rules・wire/schemaは変更しません。公開・LAN接続・証明書のOS/スマホ信頼登録・Firewall変更は行いません。現時点では物理端末を接続できる完成環境ではありません。

- 対象コード: `1f01916b906a7ea39cdd1506cfe4d4722fdc1e30`、`v2.0.187-issue8-recovery`。[PR #404](https://github.com/futsalife24-bot/katamon/pull/404) の既存監査済みコードです。
- このキット自体は新しい開発補助コードで、PR #404の独立監査PASSの対象ではありません。
- 配信元は固定Git object。dirtyファイル・現在のbranchを配信へ混ぜません。repositoryを切替・resetしません。
- GitHub保管: `futsalife24-bot/katamon` の `codex/issue8-local-acceptance-kit` branch、`tools/issue8-local-acceptance/`。
- 初回の実検証場所: `C:/Users/futsa/Documents/Codex/2026-10-06/4-pro20x-hub/katamon-local-acceptance`。元repoは `C:/Users/futsa/Documents/Codex/2026-10-03/task-2/katamon`。
- 指定モデル `gpt-6-astra / high`。実行設定の独立した取得はできておらず未確認です。

## 起動前

PowerShell 7、Node 22以上、Git、Java 21以上、firebase-tools **15.29.0**を使います。証明書ファイル生成にはPythonの`cryptography`が必要です。グローバル導入は不要です。

このフォルダで実行します。実検証PCでは依存と証明書ファイルは用意済みです。

```powershell
.\Run-Lab.ps1 Preflight
.\Run-Lab.ps1 Test
```

`ready:true` は**PC側の起動条件**だけです。スマホ到達性・証明書のbrowser信頼・secure context上のWeb Lock・PWA合格を表しません。別の作業が使うportは奪わず、競合時は停止します。

別のcheckout/PCで固定commitが存在しない場合は、既存repoの `origin/codex/issue8-recovery-pc` を通常fetchしてから再診断します。自動fetchやbranch切替はしません。必要なら `-Repository '実repoのパス'` を指定します。

Gitがsandboxアカウントの所有者不一致を検出した場合、`safe.directory=*` 等で検査を無効化せず、利用者アカウント側で実行してください。今回もGit設定を変えず、許可された利用者アカウント実行で検証しました。

依存がない環境だけ、既存npm CLIとPythonの実パスを渡します。公式JDK ZIPをキット内へ取得し、固定SHA256で照合します。npm install scriptsは無効、Firebase直接依存は固定版です。初回emulator起動時にはJavaのDB emulator artifactも取得されます。一般公開や有料サービスを開始する処理はありません。

```powershell
.\Prepare-Lab.ps1 -NpmCliPath 'npm-cli.jsの実パス' -PythonPath 'python.exeの実パス'
.\Run-Lab.ps1 Preflight
```

[Microsoft OpenJDK公式配布](https://learn.microsoft.com/en-us/java/openjdk/download) の21.0.12.1 Windows x64 ZIPを使用。今回取得した公式checksumとの一致を確認済みです。JavaとNode依存は `.runtime/`、生成証明書・実行記録は `.state/` に保存し、Git対象から除外します。証明書はlocalhost/127.0.0.1のみ・7日間です。期限後は停止を確認し、既存ファイルを保護した別保管先へ移してから生成し直します。自動削除・自動上書きはしません。

## 起動・診断・停止

1つ目のPowerShellで次を実行すると、前面のshellで起動を維持します。隠しwindowや常駐タスクは作りません。

```powershell
.\Run-Lab.ps1 Start
```

Auth/DB emulatorを `demo-catamon-registration` に限定して起動し、固定Rulesの読み戻し一致とbindを確認してからHTTPSサーバーを開きます。起動には初回のmodule読込/依存取得で時間がかかります（上限120秒）。失敗時は自分が起動したprocessだけを停止します。既存サーバーを共有・停止しません。

| 用途 | bind |
|---|---|
| HTTPS | `127.0.0.1:42884` |
| RTDB / Auth | `127.0.0.1:19000` / `127.0.0.1:19099` |
| emulator hub / logging | `127.0.0.1:19400` / `127.0.0.1:19450` |

別shellで疎通試験を実行できます。仮の匿名ユーザーをemulator内に作り、自分が生成した私室だけを作成・削除します。tokenの値は表示・保存しません。匿名ユーザーはemulatorのメモリ内に残り、停止で破棄されます。

```powershell
.\Run-Lab.ps1 Smoke
.\Run-Lab.ps1 Stop
.\Run-Lab.ps1 Preflight
```

Stopは専用のランダム停止tokenで**現在の起動process自身**へ要求し、そのprocessが保持するemulator子processだけを停止します。保存PIDから任意processをkillしません。Windowsでは所有する子process treeの終了に`taskkill /T`を使用します。停止後に `.state/session.json` がなく、全5portが空いたことを確認します。強制終了後の古いsession記録は自動削除しません。実際のprocess/portを確認してから対応してください。

HTTPS endpoint `https://localhost:42884/__lab/status` は版・hash・制限のみを返します。秘密情報は返しません。**自己署名証明書はbrowserに信頼登録していません**。Node試験は当該requestだけにCAを明示しており、OS/browserの信頼状態を変えていません。警告を無視したbrowser表示をsecure-context合格として数えないでください。

## 本番不干渉と実際の検証範囲

- 本体HTMLのDB/Auth接続先を配信時だけ同originの限定proxyへ置換し、公開API keyも架空値へ置換します。元Git objectは変更しません。
- proxyの送信先はコード内で127.0.0.1のAuth/RTDBポートに固定。外部URL、redirect追従、別namespace、管理API、browserからのAdmin Authorizationを拒否します。対象はONLINEの`rooms/open`のみで、協力部屋・登録キャラ・他モードを受入対象に広げません。
- CSPは `connect-src 'self'`。外部fetch/EventSource/WebSocket・iframe・form送信を許可せず、静的配信も公開ゲーム資産に限定します。`.git`、Rules、package情報等は配りません。
- 外部計測や外部コンテンツもCSPでブロックされます。独立headless Chromeで外部fetch/EventSource/WebSocketがCSPにより送信前に拒否され、固定HTMLの開始画面が描画されることを確認しました。本人browser/共有UIは使っていません。外部向けコードが本体ソースから完全に消えたという意味ではありません。
- Service Workerは`worker-src 'none'`と`/sw.js`拒否で無効化。元PCハーネスと同じ初期切り分けです。PWA/SW upgrade/cache復旧は**このモードでは検証できません**。
- SSEは応答をbufferせずstreamし、条件付きPUT/ETagを保持します。Rulesは固定コードの原本をそのままemulatorへ読み込み、起動時に読戻しを比較します。

2026-10-07の結果は `verification-20261007.json` に保存。補助コード5試験PASS（固定HTMLのローカルscript/link参照63件を含む）、実Auth/RTDB経由の8観測PASS、停止/5port解放を確認しました。追加のbrowser試験8項目は `browser-verification-20261007.json`。ゲーム通し対戦、実機、SW/PWA、本番A〜Kは未実施です。成功済みStage Studio/既存PC多client試験と実emulator8項目は追加工程で繰り返していません。

## 独立browser試験の再実行

```powershell
.\Run-Lab.ps1 BrowserProbe
```

Playwright moduleとChrome実行ファイルが必要です。初回検証PCの既存配置を既定値にしており、別PCでは環境変数 `KATAMON_PLAYWRIGHT_MODULE` と `KATAMON_CHROMIUM` に実パスを渡してください。自動導入やbrowser取得はしません。事前の実emulator起動は不要です。

一時HTTP/HTTPS/SSE fixtureを127.0.0.1の動的portだけへbindし、独立headless profileで固定HTMLを開きます。browserはHTTP localhostの標準secure-context判定を使い、Nodeから上流HTTPSへの1接続だけに生成証明書をCAとして渡します。browserの証明書検証、Chromium sandbox、CSP、SW機能は無効化しません。外部requestの追加guardも置きますが、guardが1件でも作動すればCSP合格にしません。

同profile/別profileのstorage分離、native Web Lockのexclusive競合とdocument終了後の解放、CSP、native EventSourceを検査します。lockは試験用名を使う基礎動作試験であり、ゲームのlease/replay/live復帰コードを呼ぶ受入ではありません。SSE backendは架空fixtureです。未信頼HTTPSをbrowserが拒否する負例も検査します。試験終了時にbrowserと自分の一時serverを閉じます。結果JSONと `.state/browser-probe.png` は再実行で更新されるため、過去の証拠を残す場合は先に別保管してください。

最初の補助試験はGit所有者の違いで起動不可。安全設定を維持し利用者アカウント実行へ変更しました。続く試験は悪いHostヘッダーにTLSのSNIまで追従したテスト条件で失敗し、SNIを実接続先localhostに固定してHost拒否を検査するよう試験を訂正しました。TLS検証は無効化していません。

## 実機へ進む際の残作業と判断

**現在のキットにはLAN bindオプションがありません。** 証明書にもLAN IPを入れていません。誤ってLANへ公開できる状態で渡さないためです。

次工程では、専用テストoriginへ接続する端末2台を特定し、その端末から到達するLANのアドレス、限定bindとWindows inbound許可の必要性、端末が信頼できるHTTPSの方法を決めます。端末への証明書登録やFirewall変更が必要なら、対象端末・証明書fingerprint・許可するアドレス/port・撤去手順を示したうえで、その操作だけを本人に判断してもらいます。OS/端末信頼登録、Firewall変更、LAN公開は今回の許可範囲外です。

読み取りで確認した既存経路、Android USB案、iPhone向けHTTPS条件、必要な本人判断は [実機への到達条件](device-readiness-20261007.md) を参照してください。Android USBが使えるなら、まずその経路を推奨します。新規のLAN公開・証明書登録が必須とは確定していません。

LAN emulatorでは携帯網からLANへ戻れない場合があるため、Wi-Fi↔携帯網の連続切替と本番A〜Kを別に残します。外部Previewや本番公開が必須と判明したわけではなく、merge/公開承認をこの準備のために要求しません。

A〜K原定義は関連Git資料・GitHub限定検索で追加取得できませんでした。既存Issue #8表のA〜Iと、未同定J/Kを維持します。元表なしにJ/Kを作って全受入完了とはしません。実機受入後にmerge判断するIssue本文と、merge/通常公開後に実機開始とする既存スマホ手順の順序矛盾も未解消です。このローカル経路が整えば前者の順序で進められます。
