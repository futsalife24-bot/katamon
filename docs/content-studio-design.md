# Content Studio MVP 設計書

更新日: 2026-08-06

## 1. 目的と対象

Content Studio は、対象ゲームへ新規キャラクターを追加・更新するための独立型管理PWAである。正式対象は Android 13 以降の現行安定版 Google Chrome、縦画面、タッチ操作、スマートフォン単体利用に限定する。PCは開発・自動テスト用途に限る。

MVPの主目的は、1枚の利用者画像から、背景補正、正規化、決定的な待機モーション、ゲーム用データ、差分、ZIP、PRまでを1本の作業フローとして完走させることである。外部認証がない場合もモックモードで同じ生成物を使い、固定画面ではなく実処理を最後まで確認できるようにする。

通常運用はOpenAI、Anthropic、Google等のLLM・生成AI APIおよび開発支援ツールへ依存しない。画像処理、モーション、データ生成、技設定、検証、ビルド、テスト、コミット、PRは、端末内の決定的処理、固定テンプレート、GitHub APIだけで完結させる。画像生成providerは将来拡張interfaceのみで初期無効とし、APIキー未設定でもMVP全工程を利用できることを必須とする。将来外部APIや有料機能を追加する場合は、実行前に「外部通信あり」「料金が発生する可能性あり」を明示し、明示同意なしには送信しない。

## 2. 調査した現在の構造

調査基準は `origin/master` の `v137` である。既存の未コミット作業を保護するため、実装は最新正本から分離した `feat/content-studio-mvp` worktreeで行う。

### 2.1 リポジトリと公開

- ゲームのエントリーポイントはルートの `index.html`。約618KB、13,000行超の単一HTMLで、CSSとJavaScriptを直接含む。
- ルートに `package.json`、lockファイル、GitHub Actions、ビルド工程はない。
- 既存ゲームのテストは `tests/` のNodeスクリプトで、外部依存なしにインラインスクリプトをDOM/Canvasスタブ上で実行する。
- 公開は `master` の静的ファイルをGitHub Pagesで配信する方式。サーバー処理は実行できない。
- 既存PWAは `manifest.webmanifest` とルートの `sw.js` を使う。`index.html` の `BUILD_ID` と `sw.js` のキャッシュ版を一致させる運用である。
- ルートService Workerのscopeはリポジトリ配下全体を覆うため、`tools/content-studio/` も制御対象になる。Content Studioへの要求は既存Service Workerから除外し、Studio専用Service Workerへ渡す必要がある。

### 2.2 キャラクターと画像

既存16体は一括移行しない。現在の情報は主に次へ分散している。

- `index.html` の `CHARACTERS`: 表示名、役割、説明、選択画面用3指標、HP、各種倍率、必殺名など。
- `CHARACTER_FACES` と `MATCHUP_FACES`: 2種類の顔切り抜き位置。
- `CHARACTER_LIST`: 許可IDと表示順。
- `CHARACTER_ASSET_VERSION`: 同名画像差し替え時の個別キャッシュ版。
- `launchShot()` と周辺関数: キャラクターID別の必殺処理。
- `database.rules.json`: オンラインデータで許可するキャラクターID。
- `tests/stage3test.js`: PNG/WebPの固定ハッシュ、画像容量、キャッシュ版。

画像は `assets/{asset-or-id}.webp` を優先し、同名PNGへフォールバックする。既存ゲームは静止画像を高さ78px相当、アスペクト比維持、底面中央で描画する。待機スプライト、GIF、アニメーションWebPは現時点では使っていない。

### 2.3 ステータスと技

- `selectStats` は選択画面の5段階表示で、実性能から自動計算されない。
- 実性能は `maxHp`、`fuelMul`、`damageTakenMul`、`blastMul`、`windMul`、`gravityMul`、`velScaleMul`、`guideMul`、`specialVelocityMul`、`tBias` などで決まる。
- 通常技は全キャラクター共通の通常弾であり、独立した技データはない。Content Studioでは `standard-projectile` として読み取り専用にする。
- 必殺技はID別分岐で実装され、発射だけでなくCPU照準、ガイド、描画、衝突、通信、テストへ影響する。
- 宣言型で安全に表現できる範囲だけをテンプレート化する。任意JavaScriptやコード入力欄は設けない。

## 3. 現在のキャラクター追加作業

現方式では最低限、次の人手作業が必要である。

1. 透明PNGと軽量WebPを追加し、寸法と見た目をそろえる。
2. キャラクター定義を追加する。
3. 表示順を追加する。
4. 2種類の顔位置、元画像の向き、接地、見かけ倍率を調整する。
5. 必殺技を既存テンプレート相当に割り当てるか、個別実装する。
6. オンライン許可IDを追加する。
7. 画像ハッシュ、個別版、全体ビルド版、Service Worker版を更新する。
8. 自動テストとモバイル目視確認を行う。
9. Firebase Rulesが変わる場合は、公開前に別経路で反映する。

## 4. 自動化範囲

### 4.1 自動化する部分

- 正規JSONの生成とスキーマ検証。
- 既存ID・slug・ファイルとの大小文字を含む衝突検出。
- PNG/WebP、アイコン、サムネイル、待機スプライト、メタデータ生成。
- 画像パス、顔位置、向き、接地、当たり判定候補のデータ化。
- 宣言型必殺テンプレートの互換データ生成。
- 新規キャラクター用カタログ、一覧、アセット版、オンライン許可変更候補の生成。
- 変更ファイル、差分、PR本文、ZIP、JSONの生成。
- モックコミット、モックPR、CI・公開状態の再現。
- 実GitHub Appサーバーによる検証済みブランチ、単一コミット、PR作成。

### 4.2 自動化が危険な部分

- 大きなHTMLへの曖昧な文字列置換。
- 既存画像の同名上書き。
- 任意コードの生成・評価。
- カスタム物理、特殊地形、複雑な状態異常の自動登録。
- 顔位置、接地、左右向きの目視確認省略。
- Firebase Rulesの無確認公開。
- 古いクライアントとのオンライン互換性を無視した公開。

危険な項目は生成を停止し、PR本文に「手動確認」または「カスタム実装が必要」と明記する。

## 5. 採用構成

```text
content/
  characters/                       新規キャラクターだけの正規JSON
generated/
  content-studio-catalog.js         決定的に生成する互換カタログ
  content-studio-manifest.json
assets/content-studio/{slug}/{hash}/
  character.png / character.webp
  icon.png / thumbnail.webp
  idle.png / idle.json / preview.png
tools/content-studio/
  src/                              React UIと純粋なドメイン処理
  public/                           Manifest、Service Worker、汎用アイコン
  server/                           GitHub OAuth/App連携。静的PWAへ秘密を含めない
  tests/                            単体・結合・Android相当E2E
  dist/                             Pages配信用ビルド成果物
```

### 5.1 クライアント

- React、TypeScript、Vite。既存ゲームとは別packageとする。
- Zodでスキーマと実行時検証を共通化する。
- IndexedDBへ下書きとBlobを保存し、localStorageへ画像や秘密情報を置かない。
- 画像処理はWorkerとOffscreenCanvasを優先し、未対応時は低解像度Canvas処理へ切り替える。
- 生成、保存、GitHub連携はinterfaceでUIから分離する。
- ZIPはブラウザ内で生成し、外部送信しない。

### 5.2 GitHubサーバー

- owner、repository、base branch、許可ユーザー、変更可能ディレクトリをサーバー側で固定する。
- GitHub OAuthのユーザートークンとGitHub Appの秘密鍵・installation tokenはサーバーだけで保持する。
- HttpOnly、Secure、SameSite cookie、state検証、CSRF、レート制限、監査ログを使う。
- base SHAの競合を検出し、masterを直接更新するAPIは実装しない。
- 受信データと画像を再検証し、Git Data APIでブランチ、1コミット、PRを作る。
- GitHub設定がない環境は同じRepositoryGatewayのMock実装を使う。

## 6. 正規データと移行方針

既存16体は手書き定義として残す。新規キャラクターだけを `content/characters/{slug}.json` へ保存し、生成カタログを既存データへ明示的にマージする。

正規データには、スキーマ版、内部ID、slug、表示情報、実性能、表示指標、通常技ID、必殺テンプレート、画像参照、顔位置、接地、衝突候補、モーションメタデータ、実装版を含める。属性、分類、レアリティ、重量など現在のゲームに効果がない項目は、管理メタデータとして保持し「ゲーム効果なし」と表示する。

既存形式変換は純粋関数と決定的な生成スクリプトで行う。手書き領域の変更は、前後マーカーが完全一致で1組だけ存在する場合に限る。0件または複数件なら中断する。

## 7. 画像処理方針

- PNG、JPEG、WebPを受け付ける。ヘッダー、容量、画素数を検査し、過大画像は最大辺2048pxの作業用画像へ縮小してから展開する。
- `createImageBitmap`、Worker、OffscreenCanvasを機能検出する。処理はキャンセル可能にし、段階進捗を通知する。
- 透明判定、縁の近似単色を連結領域として消す決定的flood-fill、市松焼き付き・黒背景警告を実装する。
- 複雑背景は消しゴム・復元ブラシで補う。外部サービスへ画像を自動送信しない。
- 自動トリミング後、全体が入る正方形へ底面中央配置する。移動、拡縮、反転、余白を非破壊設定として保持する。
- Canvas再エンコードでEXIF等を除去する。元画像は下書き内で別Blobとして保持できる。
- Object URL、ImageBitmap、不要Canvasを解放し、メモリ不足時は2048→1536→1024pxへ縮小して再試行する。

## 8. 待機モーション

生成AI動画は使わない。元画像へ周期的な平行移動、微小回転、拡縮、潰れ・伸びだけを適用する。

- 標準は8フレーム、約1.2秒、開始フレームの重複なし。
- 位相は `2π × frameIndex / frameCount` とし、境界を自然に接続する。
- 接地点を変形原点にする。全フレームの外接矩形を先に計算し、共通キャンバスで見切れを防ぐ。
- 標準、重量級、軽量、浮遊、飛行、柔体、翼あり、機械、呼吸のみ、ほぼ静止のプリセットを用意する。
- 部位マスクはschemaとprovider interfaceだけを用意し、MVPでは全体変形に限定する。
- 既存ゲームが待機スプライトをまだ使わないため、静止PNG/WebPを互換必須出力、スプライトとJSONを将来互換出力とする。

## 9. Android専用PWA

- `display: standalone`、`orientation: portrait`、maskable icon、テーマ色、背景色をManifestへ定義する。
- 画面下部の固定操作、48px以上のタップ領域、safe-area、Visual Viewport、ダークモードを使う。
- Android戻る操作はHistory APIでステップを戻し、下書きを削除しない。未保存時は確認する。
- IndexedDBへ自動保存し、再起動後に同じステップから再開する。破損検出、schema移行、複製、削除、JSON入出力、容量表示を行う。
- Share TargetはService WorkerがPOST画像を一時保存し、通常フローへ引き渡す。未対応時はファイル選択を案内する。
- Web Share、Wake Lock、Storage Persistence、Network Informationは機能検出し、未対応時は手動共有・手動再送へ戻す。
- Studio Service Workerは専用prefixで容量を制限し、更新通知後に利用者操作で切り替える。

## 10. セキュリティ方針

- IDとslugは小文字ASCII、数字、ハイフンで24文字以内。予約語、大小文字衝突、`..`、区切り文字、制御文字を拒否する。
- 表示文は長さ制限し、HTMLタグ、`javascript:`、イベント属性、スクリプト断片を拒否する。入力をコードとして評価しない。
- 画像はmagic bytes、MIME、容量、寸法を検査する。同名パスは内容ハッシュを含む不変ディレクトリで回避する。
- GitHub秘密情報、APIキー、セッション秘密はフロント、下書き、URL、ログ、ZIPへ含めない。
- 実連携の変更可能パスは `content/characters/`、`generated/`、`assets/content-studio/` と検査済み互換ファイルに限定する。
- CSP、Referrer-Policy、Permissions-Policyを配信側へ設定できる構成にし、READMEに推奨値を記載する。

## 11. 既存ゲームへの影響

MVPで既存ゲームへ加える変更は、生成カタログの読み込み・安全なマージ、宣言型技ディスパッチ、StudioパスのService Worker除外、対応テストだけに限定する。既存16体のデータ、画像、処理順を変更しない。

新規キャラクター公開時は、古いクライアントが新IDを拒否する可能性がある。BUILD_ID、Service Worker版、カタログ版、画像版、オンライン許可ルールを一体で扱い、PR本文にFirebase Rulesの手動反映を公開前ブロッカーとして出す。

## 12. MVPと将来拡張の境界

### MVP

- 画像アップロード・共有受取、端末内背景補正、ブラシ、正規化。
- 10プリセットの決定的待機モーションとスプライト生成。
- 正規キャラクターデータ、宣言型技、ゲーム相当プレビュー。
- IndexedDB下書き、JSON入出力、ZIP。
- 実生成物を使うモックGitHub成功・失敗・通信断・競合フロー。
- GitHub App/OAuthサーバー実装、PR作成、Checks/Pages状態取得。
- 単体、結合、Android Chrome相当E2E、既存ゲーム回帰。

### 将来拡張

- MLによる複雑背景除去。明示同意を得る交換可能なサーバーproviderとして追加する。
- 文章からの画像生成。`ImageGenerationProvider` interfaceのみMVPへ置き、初期状態では無効にする。有効化する将来版でも外部通信と料金可能性の確認を必須にする。
- 耳、翼、武器、尾、炎、鎖などの部位別変形。部位マスクschemaのみMVPへ置く。
- カスタム技の安全なDSL、サーバー側ビルド隔離、Firebase Rules自動配備。
- iOS、Safari、複数ブラウザ固有対応。

## 13. 検証方針

- 純粋関数の単体テスト: schema、重複、危険入力、パス、技変換、画像設定、メタデータ、ファイル一覧、PR本文、migration。
- 結合テスト: 画像→正規化→モーション→データ→ZIP、IndexedDB復元、Mock GitHub、offline outbox、cache更新。
- E2E: 現行ChromeをAndroid 13相当の縦412×915、touch、mobile user agent、DPRで実行し、9ステップ、再読み込み復旧、モックPR完了まで操作する。
- 手元提供画像はローカルQA専用とし、コミットしない。公開テストは汎用のプログラム生成画像を使う。
- 既存Nodeテストを全実行し、ゲーム起動、既存一覧、画像、基本バトル、既存技、モバイル表示、BUILD_ID/SW整合を回帰確認する。
- PlaywrightはAndroid相当であり実OSではない。ホーム画面インストール、OS共有メニュー、端末固有メモリ挙動は実機未確認として分離報告する。
