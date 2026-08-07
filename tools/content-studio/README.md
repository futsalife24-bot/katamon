# Content Studio

Content Studio は、対象ゲーム用のキャラクターモーションを Android スマートフォンで生成し、安全なPRとして登録する縦画面 PWA です。通常画像と任意の被弾用画像の取り込み、切り抜き、向き・接地点・砲口の確認、5モーション生成、最小キャラクター情報、GitHub反映を1つの下書きで管理します。

現行の `0.4.3` は「画像 → 向きと基準点 → 生成 → キャラ → GitHub」の5ステップです。生成する動きは、前進、後退、単発砲撃、被弾、着地だけに固定し、日常画面からプリセット選択や大量の調整項目を外しました。通常技は対象ゲームの標準弾、必殺技は「未設定（ボタン無効）」で登録し、後からゲーム側で設定します。

## 正式サポート

- Android 13 以降
- Google Chrome の現行安定版
- 縦画面、タッチ操作、スマートフォン単体
- ホーム画面へインストールした standalone PWA

PC は開発・デバッグ用です。iPhone、iPad、Safari、Firefox 固有対応、デスクトップ専用操作は正式サポート外です。未対応のブラウザ API は機能検出し、ファイル選択や手動再試行に切り替えます。

## AI 非依存

通常のモーション生成で OpenAI、Anthropic、Google 等の LLM・生成 AI API や Codex は呼び出しません。画像処理、背景除去、トリミング、部位候補検出、モーション、スプライト、検証、ZIP出力は、端末内プログラムと固定テンプレートだけで実行します。

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
- 同じ画像ステップで被弾時だけ使う2枚目を任意選択できます。別途用意した表情差分を選べますが、未選択なら通常画像を使います。
- PWA インストール後は、Android のギャラリまたはファイルアプリで画像を「共有」し、共有先に Content Studio を選べます。共有受取に対応しない場合は、Content Studio 内の通常の画像選択を使ってください。
- PC では開発補助としてドラッグ＆ドロップも使えます。

元画像は外部の背景除去サービスへ送信されません。ファイルヘッダーと寸法を先に検証し、過大画像は安全な処理サイズへ縮小します。開発用のサンプル画像はリポジトリに入れず、E2E テストはテスト中に汎用画像を生成します。

## キャラクターを1体追加する

1. ダッシュボードで「キャラクターを追加」を押します。
2. 「画像」で通常画像を選び、透過状態と背景警告を確認します。同じ画面で自動背景除去、自動トリム、ブラシ、位置・倍率を必要な分だけ調整します。被弾時だけ別画像へ切り替えたい場合は「被弾用画像を選ぶ」から2枚目を追加します。
3. 「向きと基準点」で元画像の向きを左・右から選び、「位置を自動検出」を押します。接地点と砲口が推測されます。ズレた印を選び、画像をタップして直します。
4. 「生成」で前進、後退、単発砲撃、被弾、着地を一括生成します。「5種類をまとめて生成」はスクロール位置に関係なく下部ナビの上へ固定され、処理中は同じ場所に進捗と中止ボタンが出ます。
5. 「キャラ」で表示名と半角小文字IDを入力します。slugはIDから自動設定され、通常技は標準弾、必殺技は未設定になります。
6. 「GitHub」で検証、生成ファイル、差分、PR本文を確認します。モーション一式のZIPもここで保存できます。
7. 「PRだけ作る」または「CI成功後にマージ」を選び、専用ブランチへの1コミットとPR作成を実行します。後者は実行直前に再確認し、CI失敗・競合・head SHA不一致ならマージしません。

画像・位置調整Canvasは `touch-action: pan-y` で縦スクロールを妨げません。入力画像は展開前に最大辺1600pxへ安全に縮小し、高画質512pxのモーション元へ一度だけ正規化します。プレビューCanvasは端末倍率へ合わせるため、再生時だけ急に粗くなりません。Web Workerが使えない端末だけ256pxの軽量代替へ切り替え、画面に明示します。単発砲撃、被弾、着地のゲーム用メタデータは非ループで、Studio上では動きを確認しやすいよう繰り返し表示し、モーションを選ぶたび0フレーム目から再生します。被弾は浮上しながら、右向き画像なら反時計回り112°、左向きなら反対方向へ回転します。反転姿勢のまま後方へ吹き飛んで接地し、低く1回だけバウンドした後、後方の接地位置で数フレーム待ってから元位置へ戻ります。画像だけを動かし、当たり判定候補は通常姿勢の位置へ固定します。Content Studio が表情や目を描き足すことはありません。

## 下書き、復旧、JSON

下書き本体、通常の元画像、任意の被弾用元画像、作業画像、マスク、正規化画像、スプライト等は、端末の Chrome プロファイル内の IndexedDB に自動保存されます。秘密情報は保存しません。

- 再開時はダッシュボードの「作業中の下書き」から開きます。
- 下書きは複製、削除、JSON エクスポート・インポートができます。JSON には関連画像も含まれます。
- 壊れた JSON、ハッシュ不一致、未対応スキーマは拒否します。古い下書きはマイグレーション後に読み込みます。
- Chrome のサイトデータ削除、アプリデータ削除、シークレットモード終了では復旧できません。重要な下書きは JSON を別の場所に保存してください。

端末の容量表示は Storage Estimate API が使える場合に表示されます。未対応でも下書き保存自体は IndexedDB で継続します。

## キャラクター登録とモックモード

モックモードでも、選んだ画像から作った実生成物を使って検証、差分、1コミット、PR、CI、マージ結果まで確認できます。固定サンプルを返す画面ではありません。次の4シナリオを切り替えられます。

- 成功: モックコミット、PR、CI 成功、公開済みを再現
- 通信切断: 再試行可能なオフラインエラーを再現
- テスト失敗: PR 作成後の CI 失敗と公開停止を再現
- GitHub 競合: 基底 SHA の不一致による安全な中断を再現

モックは実リポジトリを更新しません。生成予定ファイル、ファイル内容、差分、PR本文、モーションZIP、下書きJSONは実データで確認・出力できます。実連携でも `master` への直接pushは行わず、専用ブランチとPRだけを作ります。「CI成功後にマージ」はPR作成後の別操作であり、利用者確認、CI成功、競合なし、期待したhead SHAをサーバーで再検証してからGitHubのPRマージAPIを呼びます。

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

6. Android Chrome でログインし、生成ファイルと差分を確認して「公開準備」を実行します。サーバーが `studio/add-character-{slug}-{timestamp}` 形式のブランチを作り、1コミットで更新し、PR URLを返します。必要な場合だけ「CI成功後にマージ」を選び、最終確認後に安全条件を満たしたPRをsquash mergeします。

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

E2E は Chromium の Android 13 相当 User-Agent、`412 x 915`、タッチ、端末倍率 `2.625`、縦画面で、通常画像と被弾用画像の取り込み・保存復旧、画像上からのスクロール、切り抜き、向き・接地点・砲口の補正、被弾の112°回転を含む5モーションの高品質512px生成、生成ボタンの画面内固定、ZIP保存、モックPR、CI成功後マージ、再起動後の下書き、オフライン復帰を確認します。初回は `npx playwright install chromium` でブラウザを用意してください。

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

- 位置検出は透明輪郭を使う決定的な端末内推測です。接地点と砲口の初期位置を補助しますが、意味を理解するAI認識ではないため、ズレた場合は画像タップで直してください。目や表情の検出・合成、耳、翼、武器、尻尾等の個別変形は未実装です。表情差分は任意の被弾用画像として選択します。
- 重い AI 背景除去は未実装です。MVP は端末内の輪郭連結背景除去と手動ブラシを使います。
- 実GitHub連携では、送信前にサーバーが生成物を全面再検証し、ブランチへの1コミット後にGitHub Actionsがリポジトリ全体をビルド・テストします。MVPサーバー自身は対象リポジトリをcheckoutして任意コマンドを実行しません。
- 宣言型技の全設定は正規データとPR本文へ保持しますが、既存ゲームが直接解釈するのは安全に写像できる共通プリミティブだけです。それ以外は「カスタム実装が必要」として自動登録を停止します。
- 公開判定は GitHub の checks/deployment 情報であり、配信先のゲームを自動操作する本番スモークテストではありません。
- サーバーのセッションと公開準備情報は MVP では単一プロセス内です。複数インスタンス時は TTL 付き共有ストアへ置き換えが必要です。
- Android 相当の自動 E2E は実施対象ですが、物理 Android 実機での PWA インストール、OS 共有メニュー、カメラ、スリープ抑制、容量不足、メモリ不足、実 GitHub 認証と本番 PR、実配信先は環境がない限り未確認です。
- 実機確認前に、Android 13 以降の Chrome 現行安定版で、上記未確認項目と大きい写真のメモリ使用量を確認してください。

既存ゲームの調査、互換データ方針、影響範囲、セキュリティ方針は [`../../../docs/content-studio-design.md`](../../../docs/content-studio-design.md) を参照してください。
