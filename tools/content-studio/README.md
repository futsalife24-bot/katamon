# Content Studio

Content Studio は、対象ゲームのキャラクターを Android スマートフォンから追加・更新するための縦画面 PWA です。画像の取り込みから、切り抜き、決定的な待機モーション、ゲーム用データ、プレビュー、検証、ZIP、PR 作成までを1つの下書きで管理します。

## 正式サポート

- Android 13 以降
- Google Chrome の現行安定版
- 縦画面、タッチ操作、スマートフォン単体
- ホーム画面へインストールした standalone PWA

PC は開発・デバッグ用です。iPhone、iPad、Safari、Firefox 固有対応、デスクトップ専用操作は正式サポート外です。未対応のブラウザ API は機能検出し、ファイル選択や手動再試行に切り替えます。

## AI 非依存

通常のキャラクター登録で OpenAI、Anthropic、Google 等の LLM・生成 AI API や Codex は呼び出しません。画像処理、背景除去、トリミング、モーション、スプライト、データ生成、技変換、検証は、端末内プログラムと固定テンプレートだけで実行します。

将来用の `ImageGenerationProvider` は抽象インターフェースと未設定プロバイダーのみで、初期状態で無効です。API キーがなくても MVP の全工程を実行できます。将来、外部 API または有料サービスを追加する場合は、実行前に「外部通信あり」「料金が発生する可能性あり」を UI に表示し、鍵はサーバーだけで管理してください。

## ローカル起動

Node.js 22 以降と npm を使います。

```powershell
cd tools/content-studio
npm install
npm run dev
```

PC で `http://localhost:4174` を開きます。同じ LAN の Android から開発 PC の IP アドレスに接続できますが、Service Worker、PWA インストール、共有ターゲットは HTTPS または `localhost` の安全なコンテキストが必要です。Android で全機能を確認するときは HTTPS で配信してください。

本番相当のビルドと確認は次のとおりです。

```powershell
npm run typecheck
npm test
npm run build
npm run preview
```

`http://localhost:4175` でビルド結果を確認できます。

既存のルートをそのまま配信する GitHub Pages では、公開用ビルドは
`/tools/content-studio/dist/` にあります。`dist` は Pages が直接配信する生成物なので、
ソース変更後に `npm run build` し、差分を同じ PR に含めてください。CI はこの同期を検査します。

## PWA のインストール

1. Android Chrome で HTTPS 配信された Content Studio を開きます。
2. Chrome のメニューから「アプリをインストール」または「ホーム画面に追加」を選びます。
3. ホーム画面の Content Studio を起動します。

アプリ本体は基本画面をキャッシュします。オフライン時は下書きの編集と生成内容の確認を続行できますが、GitHub 反映は通信復帰後に再試行します。更新通知が表示されたら、下書きの保存表示を確認してから更新してください。

## 画像の取り込み

- 「キャラクターを追加」から、画像選択またはカメラ撮影を使えます。PNG、JPEG、WebP に対応します。
- PWA インストール後は、Android のギャラリまたはファイルアプリで画像を「共有」し、共有先に Content Studio を選べます。共有受取に対応しない場合は、Content Studio 内の通常の画像選択を使ってください。
- PC では開発補助としてドラッグ＆ドロップも使えます。

元画像は外部の背景除去サービスへ送信されません。ファイルヘッダーと寸法を先に検証し、過大画像は安全な処理サイズへ縮小します。開発用のサンプル画像はリポジトリに入れず、E2E テストはテスト中に汎用画像を生成します。

## 1体を追加する

1. ダッシュボードで「キャラクターを追加」を押します。
2. 「画像」でファイルまたはカメラを選び、透過状態と背景警告を確認します。
3. 「切り抜き」で背景除去、自動トリム、消しゴム・復元、位置、倍率、反転、余白を調整します。
4. 「モーション」で固定プリセットとパラメータを選び、待機スプライトを生成します。結果は元画像の変形のみで、新しい顔や部品は生成しません。
5. 「基本情報」で ID、slug、表示名、ステータス、説明等を入力します。
6. 「技」で安全な固定テンプレートと数値を設定します。テンプレートで表現できない技は「カスタム実装が必要」として仕様メモだけを保存します。
7. 「プレビュー」で向き、明暗背景、小サイズ、基準点、当たり判定候補を確認します。
8. 「検証」を実行し、エラーをすべて解消します。
9. 「GitHub 反映」で生成予定ファイル、内容、差分、PR 本文を確認します。ZIP はこの画面から端末に保存できます。
10. モックまたは GitHub App でブランチ、1コミット、PR を作成し、CI・公開状態を確認します。`main` または基底ブランチへ直接コミットする機能はありません。

既存キャラクターの更新はダッシュボードの一覧から開きます。更新時は ID と slug を固定し、別キャラクターとして誤登録しないようにしています。

## 下書き、復旧、JSON

下書き本体、元画像、作業画像、マスク、正規化画像、スプライト等は、端末の Chrome プロファイル内の IndexedDB に自動保存されます。秘密情報は保存しません。

- 再開時はダッシュボードの「作業中の下書き」から開きます。
- 下書きは複製、削除、JSON エクスポート・インポートができます。JSON には関連画像も含まれます。
- 壊れた JSON、ハッシュ不一致、未対応スキーマは拒否します。古い下書きはマイグレーション後に読み込みます。
- Chrome のサイトデータ削除、アプリデータ削除、シークレットモード終了では復旧できません。重要な下書きは JSON を別の場所に保存してください。

端末の容量表示は Storage Estimate API が使える場合に表示されます。未対応でも下書き保存自体は IndexedDB で継続します。

## モックモード

初期状態はモックモードです。GitHub アカウント、GitHub App、秘密情報、外部通信なしで、画像選択から完了画面まで確認できます。「GitHub 反映」の「失敗状態の再現」で次の4シナリオを選べます。

- 成功: モックコミット、PR、CI 成功、公開済みを再現
- 通信切断: 再試行可能なオフラインエラーを再現
- テスト失敗: PR 作成後の CI 失敗と公開停止を再現
- GitHub 競合: 基底 SHA の不一致による安全な中断を再現

モックは実リポジトリを更新しません。生成予定ファイル、ファイル内容、差分、PR 本文、ZIP、下書き JSON は実データで確認・出力できます。

## GitHub App 連携

実連携は PWA にトークンや秘密鍵を渡さず、同一オリジンの Node.js バックエンドが GitHub OAuth と GitHub App を仲介します。静的な GitHub Pages 単体では実認証は動作しません。PWA と `/api/*` を同じ HTTPS origin で配信し、リバースプロキシで API をバックエンドへ渡してください。

1. GitHub OAuth App の callback URL を `<PUBLIC_APP_URL>/api/auth/callback` にします。
2. GitHub App を固定対象リポジトリだけに install します。最小権限は Contents `Read and write`、Pull requests `Read and write`、Checks `Read-only`、Deployments `Read-only`、Metadata `Read-only` です。
3. `.env.example` をサーバーの `.env` にコピーし、次を設定します。実値をコミットしないでください。

   - `GITHUB_OAUTH_CLIENT_ID`、`GITHUB_OAUTH_CLIENT_SECRET`
   - `GITHUB_APP_ID`、`GITHUB_PRIVATE_KEY`、`GITHUB_INSTALLATION_ID`
   - `GITHUB_OWNER`、`GITHUB_REPO`、`GITHUB_BASE_BRANCH`
   - `ALLOWED_GITHUB_USERS`
   - 32文字以上の `SESSION_SECRET`
   - PWA の公開 origin である `PUBLIC_APP_URL`

4. PWA のビルド時だけ `VITE_REPOSITORY_MODE=server` を設定します。この値はモード選択だけで、秘密情報ではありません。
5. ローカルでは別ターミナルで次を起動します。Vite は `/api` を `127.0.0.1:8787` へ中継します。

```powershell
npm run server:dev
$env:VITE_REPOSITORY_MODE='server'
npm run dev
```

6. Android Chrome でログインし、生成ファイルと差分を確認して「公開準備」を実行します。サーバーが `studio/add-character-{slug}-{timestamp}` 形式のブランチを作り、1コミットで更新し、PR URL を返します。

「GitHub 反映」は GitHub API への外部通信を行います。GitHub のプランや Actions の利用量によっては料金が発生する可能性があるため、実行前に対象リポジトリと差分を確認してください。

## セキュリティ

- GitHub トークン、OAuth secret、GitHub App 秘密鍵、セッション秘密値を PWA、`localStorage`、IndexedDB、URL、ログへ入れないでください。
- owner、repository、base branch、許可ユーザー、更新可能パスはサーバーで固定します。
- バックエンドは origin、OAuth state、HttpOnly/SameSite cookie、CSRF、レート、サイズ、画像 magic bytes、SHA-256、パス、ID/slug、base SHA 競合を再検証します。本番は TLS 終端後に配置し、`NODE_ENV=production`、`HOST=0.0.0.0`、正しい `PUBLIC_APP_URL` を使います。
- ブラウザの入力値をコードとして実行しません。自由入力 JavaScript は対応しません。
- 元画像は利用者の操作なしに外部へ送信しません。GitHub 反映時は、表示された生成対象ファイルだけを送信します。
- モックモードを公開環境の権限判定の代わりに使ってはいけません。

## テスト

```powershell
npm run typecheck
npm test
npm run build
npm run server:build
npm run generate:catalog -- --check
npm run test:e2e
```

E2E は Chromium の Android 13 相当 User-Agent、`412 x 915`、タッチ、端末倍率 `2.625`、縦画面で、画像取り込みからモック PR、再起動後の下書き、オフライン復帰を確認します。初回は `npx playwright install chromium` でブラウザを用意してください。

任意のローカル画像を同じ全工程へ投入する場合は、PowerShell で `CONTENT_STUDIO_E2E_SAMPLE` にそのファイルパスを設定してから `npm run test:e2e` を実行します。パスや元画像を生成物・リポジトリへコピーしません。失敗時の画面・traceには表示中の画像が含まれ得るため、gitignore済みの `test-results/` も秘密情報と同様に扱ってください。未設定時は匿名の合成画像を端末内で作成して使用します。

リポジトリ全体の CI は `.github/workflows/content-studio.yml` で、Content Studio の型・単体/結合テスト・ビルド・サーバービルド・カタログ整合性、既存ゲームの全ハーネス、Android 相当 E2E を実行します。この Workflow に push、deploy、PR 作成処理はありません。

## 主な依存関係

直接依存はすべて MIT License です。正確なバージョンは `package-lock.json` で固定します。

| パッケージ | 目的 | License |
|---|---|---|
| React / React DOM | モバイル UI と状態表示 | MIT |
| idb | IndexedDB の型付き操作 | MIT |
| Zod | 下書き、キャラクター、生成データのスキーマ検証 | MIT |
| fflate | 生成ファイルの端末内 ZIP 出力 | MIT |
| Vite / TypeScript / esbuild | 開発・クライアント／サーバービルド・型検証 | MIT |
| Vitest / fake-indexeddb | 単体・結合・ストレージテスト | MIT |
| Playwright | Android Chrome 相当 E2E | Apache-2.0 |

背景除去モデルや生成 AI SDK は依存関係に含めていません。

## 現在の制限と未確認項目

- 部位別マスクは将来拡張用のデータ構造までで、耳、翼、武器、尻尾等を個別に動かす機能は未実装です。
- 重い AI 背景除去は未実装です。MVP は端末内の輪郭連結背景除去と手動ブラシを使います。
- 実GitHub連携では、送信前にサーバーが生成物を全面再検証し、ブランチへの1コミット後にGitHub Actionsがリポジトリ全体をビルド・テストします。MVPサーバー自身は対象リポジトリをcheckoutして任意コマンドを実行しません。
- 宣言型技の全設定は正規データとPR本文へ保持しますが、既存ゲームが直接解釈するのは安全に写像できる共通プリミティブだけです。それ以外は「カスタム実装が必要」として自動登録を停止します。
- 公開判定は GitHub の checks/deployment 情報であり、配信先のゲームを自動操作する本番スモークテストではありません。
- サーバーのセッションと公開準備情報は MVP では単一プロセス内です。複数インスタンス時は TTL 付き共有ストアへ置き換えが必要です。
- Android 相当の自動 E2E は実施対象ですが、物理 Android 実機での PWA インストール、OS 共有メニュー、カメラ、スリープ抑制、容量不足、メモリ不足、実 GitHub 認証と本番 PR、実配信先は環境がない限り未確認です。
- 実機確認前に、Android 13 以降の Chrome 現行安定版で、上記未確認項目と大きい写真のメモリ使用量を確認してください。

既存ゲームの調査、互換データ方針、影響範囲、セキュリティ方針は [`../../../docs/content-studio-design.md`](../../../docs/content-studio-design.md) を参照してください。
