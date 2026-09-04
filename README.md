# 対象ゲーム + Stage Studio

このリポジトリには、静的ブラウザゲームと、スマートフォンでカスタムステージを作成する外部Webツール`Stage Studio`が含まれる。

Stage Studioは、プリセットまたは白紙から地形を編集し、出撃地点と風を設定し、ゲームと共通の通常弾物理でテストして、JSON / ZIPとして対象ゲームへ渡すモバイル優先PWAである。通常利用にアカウント、外部AI、APIキー、有料サービスは必要ない。

## すぐに起動する

開発用依存をインストールする。

```bash
npm install
```

ローカルHTTPサーバーを起動する。

```bash
npm run serve
```

ブラウザで開く。

- 対象ゲーム: `http://127.0.0.1:4173/index.html`
- Stage Studio: `http://127.0.0.1:4173/tools/stage-studio/`

Stage StudioのService Worker、IndexedDB、ファイル共有フォールバックを正しく試すため、`file://`ではなくHTTPで開く。

ゲーム本体はビルド不要の静的`index.html`で、Stage Studioも静的配信できる。npm依存はローカルサーバーと自動E2Eだけに使い、公開後の通常利用には読み込まれない。

## ゲーム本体の曜日ダンジョン

タイトルのGARAGEまたはGear Workbenchから、JST 0時更新・1日1射の曜日ダンジョンへ入れる。専用portrait Canvasや独自の発射操作は使わず、既存のBATTLE `#game`・ドラッグ照準・弾道・FIRE・共通物理をそのまま利用する。ステージ中央のディラノから左右の近・中・遠、計6つの雲に覆われたzoneを狙い、ドラッグした方向・距離から共通物理と同じ固定計算で求める着弾zoneにより、当日の6部位（砲身、装甲、コア、動力、照準、補機）の報酬が決まる。命中したzoneだけ雲が開き、命中時は対応部位Gear 1個、外れ時は粉末3個を既存の未受取報酬として保存する。

入場、照準、退出では当日分を消費しない。FIREを端末へ保存・読戻しできた時だけ消費し、再読込時は再発射せず保存済み報酬を復旧する。v1のfired attempt、複数タブ、報酬queue/ledger、保存再試行（WAL）の安全性を維持する。完全オフライン機能のため、端末時計を未来へ進める操作やlocalStorage全消去までを完全には防げない。実機GOAL QAは今回開始せず、[`docs/tasks/2026-09-04-real-device-goal-handoff.md`](docs/tasks/2026-09-04-real-device-goal-handoff.md) のP0として別途保留する。

## 基本フロー

1. Stage Studioで`新しいステージを作る`を選ぶ。
2. プリセットとシードから生成、または白紙から描く。
3. 地形を描く・削る。Undo / Redoで調整する。
4. 2人または4人の出撃地点を置く。
5. 全体風と既存背景を選ぶ。
6. 共通物理で移動・砲撃・衝突・破壊を試す。
7. 自動検証を実行する。
8. `.stage.json`または`.stage.zip`を書き出す。
9. 対象ゲームのカスタムステージ管理からインポートする。
10. カスタムバトルで選択して試合を開始する。

カスタムステージは公式ステージと別に保存され、通常のランダム選択や公式対戦へ自動混入しない。

## ディレクトリ

```text
index.html                     対象ゲーム本体
shared/stage-core.js           スキーマ補助、生成、検証、ハッシュ、共通物理
shared/stage-storage.js        IndexedDB下書き・カスタムステージ保存
shared/stage-repository.js     保存先provider境界（MVPは端末内・通信なし）
shared/stage-zip.js            制限付きZIP入出力
schemas/stage.schema.json      ステージJSON Schema
tools/stage-studio/            Stage Studio本体とPWA資産
tests/stage-*.test.js          ステージ基盤のNode単体・結合テスト
tests/e2e/                     モバイル相当Playwright E2E
docs/                          設計、形式、利用方法、モバイルQA
```

## テスト

### Stage Studio基盤

```bash
npm run test:stage
```

対象：シード再現性、プリセット、地形・出撃地点・ギミック検証、正規化、SHA-256、ファイル名、危険データ拒否、IndexedDB境界、移行、JSON / ZIP往復。

ゲーム側のカスタムステージ管理は`StageRepositoryProvider`経由で保存先へアクセスする。MVPの`LocalStageRepositoryProvider`はIndexedDBだけを利用し、外部通信を行わない。将来の投稿機能は別providerとして追加できる。

### 既存ゲーム回帰

```bash
npm run test:existing
```

既存ゲームの回帰一式に加え、曜日ダンジョンのJST境界、一回性、保存復旧、報酬とUI契約を実行する。曜日ダンジョンだけなら次を使う。

```bash
npm run test:weekday-dungeon
npm run test:e2e:weekday-dungeon
```

既存の主要7コマンドに加えて、現行の回帰集計に含まれるロビー順序テストも実行する。

個別実行：

```bash
npm run test:seat
npm run test:regression
npm run test:result
npm run test:loopback
npm run test:stage3
npm run test:lobby
```

既存回帰とStage Studio基盤をまとめて実行する。

```bash
npm test
```

### iPhone・Android相当E2E

初回だけブラウザーを準備する。

```bash
npm run e2e:install
```

縦画面・タッチ有効のWebKitとChromiumで実行する。

```bash
npm run e2e
```

画面を見ながら確認する場合：

```bash
npm run e2e:headed
```

PlaywrightのWebKit / Chromiumは実機そのものではない。iPhone Safari、ホーム画面Webアプリ、Android Chrome、インストール済みPWAは、`docs/mobile-stage-studio-qa.md`の手順で別途実機確認する。

## PWAとオフライン

- Stage Studioはインストールせず通常のSafari / Chromeでも利用できる。
- iPhoneではSafariの共有メニューから`ホーム画面に追加`する。
- Androidではアプリ内案内またはChromeメニューからインストールする。
- 初回オンライン読み込み後は、アプリシェルと下書き編集をオフラインで利用できる。
- 更新時は編集中の下書きを保存してから新しいService Workerへ切り替える。
- 端末保存はOSやブラウザによって整理される場合があるため、JSON / ZIPバックアップも定期的に保存する。

## 共有とインポート

共有は軽量JSONのファイル付きWeb Shareを最優先し、非対応環境ではファイル保存、Blobダウンロード、JSONコピーへフォールバックする。ZIPは`ZIPを書き出す`で保存してから各アプリへ添付する。LINE、Discord、メール、AirDrop等にはOS共有シート、または各アプリのファイル添付から渡す。

対象ゲームはインポート時にスキーマ、容量、許可リスト、互換性、SHA-256を再検証する。同じ表示名でも`stageId`または`contentHash`が異なるものは別データである。管理画面のカードと選択欄には`stageId`、`schemaVersion`、`contentHash`、`gameCompatibility`を表示し、バトル開始直前にも`selectStage`経由で4項目を再照合する。

## セキュリティ

- 任意JavaScript、HTML、CSS、外部URLをステージへ保存しない。
- `eval`と`Function`コンストラクターを使わない。
- 作者名と説明はHTMLとして描画しない。
- JSON 2MiB、ZIP 6MiB、解凍後12MiBを上限にする。
- 座標、列、区間、スポーン、ギミック、JSON深度、文字列長を制限する。
- 未対応素材、背景、ギミックをallowlistで拒否する。
- ZIP Slip、重複エントリー、CRC不一致、不正画像、過大展開を拒否する。
- 正規化JSONのSHA-256をインポート時とバトル開始時に確認する。
- Stage StudioのCSPは外部接続を許可しない。

## 対応範囲

MVPは端末内保存、ファイル共有、同一端末または事前配布済みファイルによるカスタムバトルを対象とする。

未対応：

- オンライン投稿広場
- ホストから参加者へのカスタムステージ自動配布
- ステージIDによるダウンロード
- 利用者背景画像
- 対象ゲームにまだ存在しない素材とギミック
- 特殊技全種類を含む完全なStudio内試合

新しいサーバーは設置していない。Stage Studioの生成・編集・検証・テスト・保存・出力は端末内だけで完結する。

## ドキュメント

- [Stage Studio設計](docs/stage-studio-design.md)
- [ステージ形式仕様](docs/stage-format.md)
- [利用ガイド](docs/stage-studio-user-guide.md)
- [モバイルQA](docs/mobile-stage-studio-qa.md)
- [既存ゲームテスト](tests/README.md)

`.env.example`は作成していない。MVPに外部サービス用の環境変数や秘密情報が不要なためである。
