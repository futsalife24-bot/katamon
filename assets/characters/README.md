# キャラクター画像

キャラクター画像は、用途ごとに次の2系統を対で管理します。

- `master/*.png`: リポジトリ内の正本画像。WebP非対応環境のフォールバックにも使います。
- `runtime/*.webp`: アプリが通常読み込む軽量画像。

ここでいう `master` は「現在リポジトリに保管しているPNG正本」です。画像生成時の未加工・高解像度データが別に存在する場合、その代わりではありません。

## 対応表

| 内部キー（変更禁止） | 表示名 | ファイル名 |
| --- | --- | --- |
| `kyoryu` | ディラノ | `dirano` |
| `medama` | アイボルト | `eyebolt` |
| `iwa` | ゴーロッカ | `gorocca` |
| `tori` | フェニーチェ | `fenice` |
| `barugerukan` | バルゲルカン | `barugerukan` |
| `nisenmono` | オベリスク | `obelisk` |
| `burumutan` | ブルームタン | `bloom-tan` |
| `sumoeru` | スモエル | `sumoeru` |
| `doRednote` | ドレッドアロー | `dread-arrow` |
| `hamulton` | ハムルトン | `hamulton` |
| `mocchario` | モッチャリオ | `mocchario` |
| `mecha` | クロムギア | `chrome-gear` |
| `akuma` | ルビデビ | `rubidevi` |
| `jinba` | アスタウロス | `astauros` |
| `kishi` | パラディエ | `paladier` |
| `neko` | にゃんタンク | `nyan-tank` |
| `shinigami` | ヨミガマ | `yomigama` |

内部キーはセーブデータ・通信・Firebase Rulesとの互換性に関わるため、表示名や画像名に合わせて変更しません。

## 画像を差し替えるとき

1. 同じファイル名のPNGとWebPを必ず一緒に更新する。
2. `index.html` の `CHARACTER_ASSET_VERSION` で対象キャラの版を上げる。
3. `tests/stage3test.js` のPNG/WebPハッシュを更新する。
4. ローカルHTTPと実ブラウザで、WebP表示とPNGフォールバックを確認する。

片方だけの更新や、版番号を据え置いた差し替えは禁止です。端末やService Workerのキャッシュによって、古い画像や異なる画像が表示されます。
