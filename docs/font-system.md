# カタモン フォントシステム

## 基本ルール

カタモンとStage Studioは、次の2フォントだけを基本として使う。

| 役割 | フォント | 主な使用箇所 |
|---|---|---|
| 見せる文字 | Reggae One | タイトル、ロゴ周辺、大カテゴリ、モード名、BATTLE START、VS、WIN / LOSE、BOSS BATTLE、必殺技名、リザルト大見出し |
| 読ませる文字 | RocknRoll One | メニュー、ボタン、名前、戦闘情報、ステータス、チュートリアル、設定、説明、ダイアログ、Stage Studioの編集UI |

Reggae Oneは短く大きい文字だけに限定する。本文、長い説明、小型ボタン、数値情報には使わない。画面内のフォント変更は、視覚的な階層を作る場合だけ行う。

## 実装

共通定義は`assets/fonts/katamon-fonts-v178.css`に置く。

- `--katamon-font-display`: Reggae Oneを先頭にした見出し用
- `--katamon-font-ui`: RocknRoll Oneを先頭にした通常UI用
- Canvasは`UI_FONT_DISPLAY`と`UI_FONT`を同じ役割分担で使う
- `button`、`input`、`select`、`textarea`は通常UIフォントを継承する

各フォントはRegular 400を使用する。RocknRoll Oneは利用者が入力する日本語を欠けさせない全文字版、Reggae Oneは出荷するUIソースの文字を収録した軽量WOFF2である。v178の実行素材は`reggae-one-display-v178.woff2`（1,368コードポイント、148,032 bytes）。旧ファイルは旧版の参照用に保持する。太字が必要な通常UIは追加ウェイトを取得せず、端末側の合成ウェイトを使う。

ゲームの通常UIフォントは最初のタイトルタップで有効化する。Service Workerの有無やT2素材キャッシュの完了通知に依存させない。最初のタップ前は従来のOSフォールバックを維持し、大容量の本文フォントを先行取得しない。

見出し用フォントの再生成は`tools/build-display-font.py`へ公式原本TTFを渡す（開発用にfonttoolsとbrotliが必要）。固定した公式原本のURL、SHA-256、入力ファイル、必須表示語は`assets/fonts/display-font-manifest.json`へ記録する。文字追加時は再生成し、配信ファイル名・共通CSS・ゲームpreload/初期キャッシュ・Stage Studio SWを揃える。ファイル名を更新して古い永続キャッシュとの混在を避ける。

## 配信と安全性

- フォント、CSS、ライセンスはリポジトリ内へ同梱する
- Google Fonts等への通常時の外部通信は行わない
- ゲーム本体のT2とStage StudioのService WorkerへCSS・フォントを登録し、オフラインでも使えるようにする。CSSも改版ファイル名で配信し、旧CSSが古いフォント参照を復活させないようにする
- `font-display: swap`でフォント取得待ちによる操作不能を避ける
- 読込失敗時はOSの日本語ゴシック体へ安全にフォールバックする

## 追加・変更時の確認

1. 新しい通常UIがRocknRoll Oneを継承していること
2. Reggae Oneの使用箇所が短い大見出しまたは演出であること
3. 新しいReggae One表示文字がサブセットへ含まれること
4. 390px幅と412px幅でボタンの文字切れ・折返し・横はみ出しがないこと
5. WebKitとChromiumで両フォントが読み込まれること
6. PWA更新後も下書きやセーブデータが失われないこと

長文の可読性に明確な問題が実機で確認されるまでは、本文専用の第3フォントを追加しない。

`tests/e2e/font-repair.spec.js`は、主要見出しのブラウザ描画・Chromiumで実際に使用されたフォント（代替文字混入の検出）・SWなしの最初のタップからGARAGE/協力ロビーを確認する。`progressive-precache.spec.js`はフォントのキャッシュ収録とオフライン再起動後の有効化も確認する。
