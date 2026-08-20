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
- Checks: `Read-only`
- Deployments: `Read-only`
- Metadata: `Read-only`

GitHub Appは対象repositoryだけへinstallしてください。owner、repository、base branch、許可ユーザー、書き込み可能パスはサーバー環境変数とコード側の双方で制約されます。base branchのrefを更新するAPIはありません。新しい `studio/add-character-*` branchを作り、Git Data APIで1コミットを作ってPRへ渡します。

## 本番配置

PWAとAPIを同じoriginで公開し、リバースプロキシで `/api/*` をこのNodeプロセスへ転送してください。静的なGitHub PagesだけではOAuth callback、HttpOnly cookie、GitHub App秘密鍵を安全に扱えないため、実連携は動きません。`PUBLIC_APP_URL` は公開origin、`HOST=0.0.0.0`、`NODE_ENV=production` を指定します。TLS終端後も `Secure; HttpOnly; SameSite=Lax` cookieを維持してください。

このMVPのsessionと公開準備情報はプロセスメモリ内です。単一インスタンスで運用し、複数インスタンス化する場合はTTL付き共有ストアへ `SessionStore` とpreparation storeを置き換えてください。秘密値やOAuth codeをログへ出さず、監査ログの利用者識別子はHMACで匿名化されます。

## サーバー側の再検証

- ID/slug、危険文字、path traversal、大文字小文字衝突
- 許可ディレクトリと固定生成ファイル
- Base64、申告容量、SHA-256、画像magic bytes、画像寸法
- 正規キャラクターJSONとのID/slug一致、既存ID衝突
- immutableな画像パスへの上書き禁止
- prepare時とbranch作成直前のbase SHA競合
- Origin、CSRF、許可GitHubユーザー、rate limit

`generated/content-studio-catalog.js` は任意JavaScriptを許可せず、固定ラッパーの内側がJSONだけである場合に限り受け付けます。追加の互換ファイルを許可する場合も `GITHUB_ALLOWED_EXACT_FILES` へ明示し、サーバーが対応する非実行形式だけを使ってください。
