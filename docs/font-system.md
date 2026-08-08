# カタモン フォントシステム

## 基本ルール

カタモンとStage Studioは、次の2フォントだけを基本として使う。

| 役割 | フォント | 主な使用箇所 |
|---|---|---|
| 見せる文字 | Reggae One | タイトル、ロゴ周辺、大カテゴリ、モード名、BATTLE START、VS、WIN / LOSE、BOSS BATTLE、必殺技名、リザルト大見出し |
| 読ませる文字 | RocknRoll One | メニュー、ボタン、名前、戦闘情報、ステータス、チュートリアル、設定、説明、ダイアログ、Stage Studioの編集UI |

Reggae Oneは短く大きい文字だけに限定する。本文、長い説明、小型ボタン、数値情報には使わない。画面内のフォント変更は、視覚的な階層を作る場合だけ行う。

## 実装

共通定義は`assets/fonts/katamon-fonts.css`に置く。

- `--katamon-font-display`: Reggae Oneを先頭にした見出し用
- `--katamon-font-ui`: RocknRoll Oneを先頭にした通常UI用
- Canvasは`UI_FONT_DISPLAY`と`UI_FONT`を同じ役割分担で使う
- `button`、`input`、`select`、`textarea`は通常UIフォントを継承する

各フォントはRegular 400を1ファイルだけ同梱する。RocknRoll Oneは利用者が入力する日本語を欠けさせない全文字版、Reggae Oneは強調演出で使用する文字へ絞った軽量WOFF2である。太字が必要な通常UIは追加ウェイトを取得せず、端末側の合成ウェイトを使う。

## 配信と安全性

- フォント、CSS、ライセンスはリポジトリ内へ同梱する
- Google Fonts等への通常時の外部通信は行わない
- ゲーム本体とStage StudioのService Workerへフォントを登録し、オフラインでも使えるようにする
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
