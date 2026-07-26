# tests — ブラウザなしで index.html を回す検証ハーネス

`index.html` の `<script>` を抜き出し、Canvas / WebAudio / DOM をスタブした Node 上で実行する。
ブラウザを開けない状況(リモート画面・CI)でも、実際にポインタイベントを流して
1試合まるごと進められる。実行にビルドも依存パッケージも要らない。

```bash
node tests/seattest.js p1
node tests/seattest.js e1
node tests/regressiontest.js p1
node tests/regressiontest.js e1
node tests/resulttest.js
```

引数は「席」= この端末がどのユニットを操作するか。`p1` が通常のCPU戦、
`e1` はオンライン対戦のゲスト側(画面右の席)を想定した検証用。
ゲーム側は `?seat=e1` という URL パラメータで同じ切り替えができる。

| ファイル | 中身 |
|---|---|
| `seatharness.js` | スタブとフックの土台。`globalThis.__kt` にゲーム内部を露出する |
| `seattest.js` | Stage 2a「視点の切り離し」。入力・HUD・弾のowner・勝敗が席側を向いているか(18項目) |
| `regressiontest.js` | CPU戦の完走・中断再開のラウンドトリップ・フリーモード(20項目) |
| `resulttest.js` | 結果画面の「タイトルへ戻る」。勝利時だけ中断セーブして連勝を守る(26項目) |

## 注意

- **検証フックは `seatharness.js` が実行時に注入する。`index.html` には一切入れない。**
  本体を汚さないので、消し忘れが起きない
- **カットイン中はゲーム進行が止まる。** `cutIn` を外から `null` にすると
  `showCutIn` の `onDone`(タイムアップ判定など)が消えて試合が終わらなくなる。
  飛ばさず `settle()` で経過させること
- スタブなので描画結果の見た目は確認できない。**色や配置の最終判断は実機で目視すること**
