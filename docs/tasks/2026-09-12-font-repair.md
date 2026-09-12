# GARAGE・協力ロビーのフォント修正

対象: ユーザー提供のPhoto 1（協力ロビー）、Photo 2（GARAGE）。公開済みv2.0.177からの修正。

## 原因と対応

- 通常UIのRocknRoll Oneを有効にするCSSが`media=print`のまま、SWのT2完了通知まで切り替わらなかった。素材取得が止まる場合、SWが使えないブラウザ、完了済みのT2を再要求して通知が出ない場合に代替書体が残る。最初のタイトルタップでCSSとCanvasのフォントを切り替え、T2通知から独立させた。タップ前の通信量は維持する。
- 見出し用Reggae Oneの旧WOFF2は250コードポイントだけを含み、「実績」「曜日迷宮」「鋼鉄要塞」全字、「ショップ」の「ョ」、ボス名の一部などが欠けていた。文字ごとのOS/通常UIフォントへの置換が書体混在の原因。
- 公式の同フォントから、旧収録文字と出荷UIソースの文字を含む1,368コードポイント、148,032 bytesのWOFF2を生成。画像や別書体への置換は行わず、元のフォント指定を実現した。原本の固定URL・ハッシュ・対象文字は`assets/fonts/display-font-manifest.json`、再生成手順は`docs/font-system.md`。
- `reggae-one-display-v178.woff2`と`katamon-fonts-v178.css`という新しいパスで配信し、旧PWAの永続キャッシュと区別する。旧ファイルは保持。共通CSS、ゲームのpreload/初期キャッシュ、Stage Studioのオフライン収録を整合した。
- 追加したオフライン検査で、preload済みWOFF2のHTTPキャッシュコピーだけでは永続保存が保証されないことも検出。CSSとWOFF2をT2へ明示収録した。Chromiumは1回、初回ページとSWのHTTPキャッシュを共有しないWebKitは最大2回までというフォント取得数も検査する。
- アプリBUILD / SWは`v2.0.178-font-repair`、Stage Studio SWは`1.8.2-font-coverage`。ゲーム挙動・Firebase・保存形式は変更していない。

## 検証

- フォントを共有する既存統合・Stage Studio UI: 21/21成功。キャッシュ版管理2/2、APP_SHELL3/3成功。
- Chromiumで主要8見出しの実描画フォントをCDPから取得し、すべてReggae Oneで代替フォントの混入がないことを確認。`document.fonts.check`だけでは文字ごとの欠落を検出できないため、実使用フォントを検査する。
- Service Workerを無効にした390×844画面で最初のタップ、GARAGEの3メニュー、協力ロビーの両ボス名・ソロボタンを確認。通常UIはRocknRoll One、見出しはReggae One。pageerror 0。
- 段階キャッシュのChromium検査成功。初期通信7,126,834 bytes、T3b完了77,552,070 bytes、重複素材通信0。オフライン再起動後のCSS有効化と通常UIフォントの読込も成功。
- Chromiumの4検査（主要表示語、SWなしの最初のタップ、段階キャッシュ/オフライン再起動、saveData）成功。WebKitもフォント読込と段階キャッシュ成功。WebKitの全ゲーム描画は既存runner制約のため新テスト1件をskipし、主要表示語は独立ページで確認する。物理スマホは未実施。

## 監査情報

- branch: `fix/font-repair-20260912`
- base: `bc8dcbd8d14ddc453179244e8bcbca4779e96e8e`
- 実装場所: `.codex-worktrees/font-repair-20260912`。ルートと第2ボスworktreeの既存差分は保持。
- 配信とマージの確定情報は対応するGitHub PRとルート`CURRENT_WORK_STATE.md`へ記録する。
