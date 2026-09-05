# Content Studio GitHub backend

このディレクトリは、静的PWAへ秘密情報を置かずにGitHubへPRを作る交換可能なバックエンドです。画像処理や待機モーションは端末内で行い、このサーバーの外部通信先はGitHub OAuthとGitHub APIだけです。生成AI APIや有料画像サービスには接続しません。

## ローカル起動

1. `tools/content-studio/.env.example` を `.env` へコピーし、実値はローカルだけに保存します。
2. OAuth Appのcallback URLを `http://localhost:4174/api/auth/callback` にします。Viteが `/api` を `127.0.0.1:8787` へ転送します。Chromeのlocalhost例外を使ってもcookie自体の `Secure` 属性は外しません。
3. `npm run server:dev` と `npm run dev` を別々に起動します。

本番相当では `npm run server:build` 後に `npm run server:start` で、検証済みの単一bundleを起動します。

環境変数が未設定でもサーバーはhealth応答を返しますが、実GitHub操作は503で安全に停止します。PWAのモックモードはサーバー認証なしで最後まで確認できます。本番環境では設定不足のまま起動しません。

## GitHub側の最小権限

OAuth Appは管理者の本人確認にだけ使い、OAuth tokenはcallback処理後に破棄します。書き込みは固定repositoryへinstallしたGitHub Appだけが行います。

- Repository permissions: Contents `Read and write`
- Pull requests: `Read and write`
- Checks / Actions / Commit statuses: `Read-only`
- Administration: `Read-only`（branch protectionの確認用。管理設定は変更しません）
- Deployments: `Read-only`
- Metadata: `Read-only`

GitHub Appは対象repositoryだけへinstallしてください。owner、repository、base branch、許可ユーザー、書き込み可能パスはサーバー環境変数とコード側の双方で制約されます。base branchのrefを更新するAPIはありません。新しい `studio/add-character-*` branchを作り、Git Data APIで1コミットを作ってPRへ渡します。

## 本番配置

PWAとAPIを同じoriginで公開し、リバースプロキシで `/api/*` をこのNodeプロセスへ転送してください。静的なGitHub PagesだけではOAuth callback、HttpOnly cookie、GitHub App秘密鍵を安全に扱えないため、実連携は動きません。`PUBLIC_APP_URL` は公開origin、`HOST=0.0.0.0`、`NODE_ENV=production` を指定します。TLS終端後も `Secure; HttpOnly; SameSite=Lax` cookieを維持してください。

sessionと準備キャッシュはプロセスメモリ内です。再起動後は再認証し、保存した生成物から既存GitHub branch/commit/PRを照合します。復旧の正本はGitHub上の署名付きcommitです。複数インスタンスで同じ公開操作が競合してもbranch/PRの一意性で照合しますが、ログインセッションは共有しないため単一インスタンスまたはsticky routingで運用してください。秘密値やOAuth codeをログへ出さず、監査ログの利用者識別子はHMACで匿名化されます。

## サーバー側の再検証

- ID/slug、危険文字、path traversal、大文字小文字衝突
- 許可ディレクトリと固定生成ファイル
- Base64、申告容量、SHA-256、画像magic bytes、画像寸法
- 正規キャラクターJSONとのID/slug一致、既存ID衝突
- immutableな画像パスへの上書き禁止
- prepare時とbranch作成直前のbase SHA競合
- Origin、CSRF、許可GitHubユーザー、rate limit

`generated/content-studio-catalog.js` は任意JavaScriptを許可せず、固定ラッパーの内側がJSONだけである場合に限り受け付けます。追加の互換ファイルを許可する場合も `GITHUB_ALLOWED_EXACT_FILES` へ明示し、サーバーが対応する非実行形式だけを使ってください。

## Phase 1の安全境界

`RepositoryService.prepare` はbase SHAを固定し、`snapshot.ts` でそのtreeの全canonicalと参照ファイルを読み、1体だけ更新してcatalog/manifestを再構成します。対象外の正規レコードや画像は保持します。ブラウザの全体ファイルは正本にせず、提出された場合は再構成結果との完全一致を要求します。全参照のpath・MIME・ハッシュ・schema・metadata・スプライト寸法を照合し、基準snapshotが不完全なら停止します。画像検証はmagic bytes/寸法の検証であり、全画像のデコード検査ではありません。

prepareの返却差分とcommit対象は同じsnapshot digestに結び付けます。branch名は本人のGitHub numeric ID・repo・base ref・bundle digestからHMACで導きます。commit本文のHMACはさらにbase SHAとtree SHAを結び付けます。復旧では本人・repository・branch・single parent・署名・全treeを再検証します。認証情報は保存物に含めません。`SESSION_SECRET` は安全に安定保持してください。交換した場合は過去の署名を信頼せず停止します。

準備TTLは従来の30分です。失効時はTTLを延ばさず再準備します。メモリは16操作/64MiB、snapshot監査は500canonical/256MiBに制限し、上限では安全に停止します。同じ公開操作の再準備はキャッシュを置き換えます。成功応答を失ったbranch/PR/mergeはGitHubに再照会して復旧し、閉じた未merge PRや変更されたheadを再作成・強制更新しません。

## 管理者による外部設定（未設定時は自動merge停止）

対象base branchに以下のclassic branch protectionを設定し、GitHub Appに読み取り権限を与える必要があります。このPhaseは管理者設定を変更しません。rulesetだけでは現実装の保護確認を通しません。

- Require status checks to pass + Require branches to be up to date（strict）
- 必須チェック名 `Type, unit, integration, build and regression` と `Android 13 portrait Chromium E2E`、expected sourceはいずれもGitHub Actions（app ID 15368）
- 管理者にも適用（enforce_admins）。PR bypass allowanceなし。force push/deleteは禁止
- 内容・権限・workflowの変更は外部監査で管理する。保護を解除できる管理者の意図的な同時変更までアプリだけで防ぐものではない

`getChecks` はworkflowの最新run/attemptを特定し、ページングしたjobs・check runsとstatus contextsを照合します。両方の重要jobが該当headでcompleted/successである必要があり、欠落・遅延・skipped/neutral等は通しません。追加の必須status contextも欠落を許可しません。未対応の追加check形式は安全に停止します。

merge直前のmaster GETは診断であって原子的な競合防止ではありません。expected head付きmerge APIとGitHubが強制するstrict必須チェックを組み合わせます。保護の未設定・取得不能、base/head drift、PRのrepo/ref/state不一致ではmerge APIを呼ばず、PRを保持します。base drift後の自動rebase/force pushは提供しません。

公式仕様: [branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)、[protection API](https://docs.github.com/en/rest/branches/branch-protection?apiVersion=2022-11-28)、[workflow jobs](https://docs.github.com/en/rest/actions/workflow-jobs?apiVersion=2022-11-28)、[commit statuses](https://docs.github.com/en/rest/commits/statuses?apiVersion=2022-11-28)。

## Phase 1-R1：追加必須CI・明示的な後継操作

保護設定の `checks` はcontextとapp IDを組で保持します。APIの明示的null／-1とlegacy contextsだけを実行元非固定として扱います。追加のGitHub Actions check-runもcheck suiteからworkflowを特定し、対象SHAの最新run・attempt・jobを照合します。test／mobile-e2eを必須から除外しません。ページングは全ページを読み、上限超過は停止します。checkとstatusが同名の場合は両方の成功が必要です。app固定名にstatusが併存するとstatus APIではappを証明できないため、`required_checks_unsupported` で停止し、待機と区別します。同名workflow/job・複数実行元・不正設定も確認できるまで通しません。

通常の再試行は凍結bundleを再利用します。最新baseで作り直すときだけ `revalidation` に元branch/head/base/digestと新baseを渡します。backendは元操作のactor/repo署名、PR状態、single parent、全treeを再検証し、旧baseと新baseで対象canonicalのblob SHAが変わっていないことを確認します。他キャラは新baseの全canonicalから再構成します。操作digestにこの関係を含めるため、同じ後継操作の再試行は同じbranch/PRへ収束します。元PRをcloseせず、force pushも行いません。

新baseの差分承認と新headのCIが必要です。対象キャラの競合、元PRの改変・merge・close、baseの再変更は停止します。管理者設定・secretの変更はこの実装に含みません。外部監査のMERGE GOは別途必要です。
