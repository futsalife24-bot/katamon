# Stage Studio ステージ形式仕様

仕様バージョン: 1.0.0
更新日: 2026-08-06

## 1. 正式な配布形式

Stage Studioは次の2形式を正式に扱う。

- 軽量形式: `<安全な名前>.stage.json`
- バンドル形式: `<安全な名前>.stage.zip`

どちらも宣言型データだけを含む。JavaScript、HTML、CSS、関数、外部URL、実行命令は格納できない。独自拡張子を追加する場合も、JSONとZIPを互換フォールバックとして維持する。

機械検証用のJSON Schemaは`schemas/stage.schema.json`、実行時の正規化・追加検証は`shared/stage-core.js`を正本とする。JSON Schemaだけでは表現しづらい区間の非重複、ハッシュ、ファイルサイズ、公平性は実行時にも検証する。

## 2. 互換性識別子

| 項目 | MVP値 |
|---|---|
| `schemaVersion` | `1.0.0` |
| `generatorVersion` | `1.0.0` |
| `gameCompatibility.gameId` | `katamon`（既存ゲームの内部互換ID） |
| `gameCompatibility.minBuild` | `v138` |
| `gameCompatibility.maxBuild` | 上限なしの場合`null` |

ゲームは、対応外の`schemaVersion`、異なる`gameId`、自身より新しい`minBuild`を安全に拒否する。表示名が同じでも、`stageId`または`contentHash`が異なるデータは別ステージとして扱う。

## 3. ルートオブジェクト

Stage Studioが正規出力するフィールドは次のとおり。JSON Schema上の`generation`は旧入力との境界として省略可能だが、正規化後は必ず既定値を補う。それ以外は必須である。

| フィールド | 型 | 制約・用途 |
|---|---|---|
| `schemaVersion` | string | `1.0.0` |
| `stageId` | string | `stage_`で始まる安全な内部ID。既定生成は32桁16進数、形式上は接頭辞後8～80文字。表示名とは独立 |
| `title` | string | 1～48文字 |
| `description` | string | 0～500文字 |
| `authorDisplayName` | string | 0～32文字。実在人物を要求しない |
| `createdAt` | string | ISO 8601 UTC日時 |
| `updatedAt` | string | ISO 8601 UTC日時 |
| `generatorVersion` | string | 生成器のバージョン |
| `seed` | string | 最大96文字 |
| `gameCompatibility` | object | 対象ゲームとの互換範囲 |
| `stageWidth` | number | MVPでは1440固定 |
| `stageHeight` | number | MVPでは編集・戦闘領域660固定 |
| `coordinateSystem` | object | 左上原点、X右、Y下、px |
| `terrain` | object | 列区間形式の地形 |
| `materials` | array | 許可された地形素材 |
| `spawnPoints` | array | 2または4地点、最大4 |
| `gimmicks` | array | 許可されたギミック、最大16 |
| `decorations` | object | 装飾表示設定 |
| `background` | object | 許可された背景プリセット |
| `battleRules` | object | カスタムバトル用制約 |
| `preview` | object | プレビューの有無と寸法 |
| `generation` | object | プリセットと生成パラメーター。入力時のみ省略可、正規出力には必ず含む |
| `checksums` | object | SHA-256 content hash |

Canvas全体は540×960pxだが、下部は操作パネルである。`stageHeight=660`は編集・戦闘領域、地形区間の最大下端636は落下死亡線と一致する。`coordinateSystem`は`origin: top-left`, `unit: px`, `xAxis: right`, `yAxis: down`, `terrainColumnWidth: 3`, `terrainRowHeight: 4`を固定値として持つ。

## 4. 地形

```json
{
  "encoding": "column-segments-v1",
  "columns": [
    [[420, 636]],
    [[418, 636]],
    [[180, 216], [416, 636]]
  ],
  "destructible": true,
  "minimumThickness": 12
}
```

`columns`は正確に480列を持つ。各列は最大32個、ステージ全体では最大4096個の`[topY,bottomY]`区間を持つ。

- `topY`と`bottomY`は有限数。
- `0 <= topY < bottomY <= 636`。636は対象ゲームの地形下端兼落下死亡線である。
- 区間は`topY`の昇順。
- 同じ列の区間は重複しない。
- 空配列は地形がない列、つまり奈落を表す。
- 12px未満の区間は保存可能だが、引っ掛かりや破損リスクとして警告する。
- 砲撃による穴はステージ原本へクレーター履歴として保存せず、試合中の一時状態として衝突グリッドへ反映する。

MVPの素材許可リストは次のみ。

```json
{
  "id": "terrain",
  "type": "destructible",
  "destructible": true,
  "color": "#7A5435"
}
```

色は`#rrggbb`形式。`materials`は通常地形・鋼鉄の最大2件まで指定できる。通常地形に加え、次の鋼鉄を選べる。

```json
{
  "id": "steel",
  "type": "indestructible",
  "destructible": false,
  "color": "#49515B"
}
```

鋼鉄はステージ全体または`terrain.materialSegments`で指定した区画へ使う。区画は列ごとの`[top, bottom, "steel"]`で表す。砲弾は鋼鉄へ当たって爆発するが、鋼鉄の形と当たり判定は削れない。爆風のユニット判定は鋼鉄を通り、キャラクターは通常どおり上に乗れる。氷、沼、バウンド、ダメージ地形は未対応。

## 5. 出撃地点

```json
{
  "id": "spawn_p1",
  "slot": "p1",
  "team": "player",
  "order": 1,
  "x": 216,
  "y": 404,
  "direction": "right"
}
```

許可スロット順は`p1`, `e1`, `p2`, `e2`。1対1はp1とe1、2対2は4スロットを使う。

- `id`と`slot`は重複不可。
- `team`は`player`または`enemy`。
- `direction`は`left`または`right`。
- X、Yはステージ範囲内の有限数。
- ユニット半径16pxを考慮し、地形内、画面外、他地点との重なりはエラー。
- 地面から離れている、崖に近い、左右の高度差・中央距離差が大きい場合は警告。

## 6. ギミック

MVPの許可リストは`globalWind`のみ。

```json
{
  "id": "gimmick_wind",
  "type": "globalWind",
  "direction": 1,
  "strength": 0.35
}
```

- `direction`: 左向き`-1`または右向き`1`
- `strength`: 0以上1以下
- 1ステージにつき最大1件
- 無風はギミックを省略するか`strength: 0`で表す

未対応の`type`は無視せずエラーとして拒否する。任意コードを設定するフィールドは存在しない。

## 7. 背景・装飾・ルール

背景例：

```json
{
  "mode": "theme",
  "theme": "grass",
  "color": "#87B9D8",
  "gradient": {
    "from": "#6DA9D2",
    "to": "#D7E8E8"
  }
}
```

許可プリセットは`grass`, `desert`, `snow`, `volcanic`。MVPでは利用者画像と外部画像URLを受け入れない。

装飾例：

```json
{
  "enabled": true,
  "foreground": [],
  "background": []
}
```

バトルルール例：

```json
{
  "format": "1v1",
  "maxPlayers": 2,
  "turnLimit": null,
  "rankedAllowed": false,
  "onlineAllowed": false
}
```

公式対戦、通常ランダム選択へカスタムステージを混入させる値は許可しない。

`onlineAllowed: false`は公開マッチや自動マッチングへの投入を許可しないという現行スキーマの安全フラグである。対象ゲームのプライベート部屋でホストが明示選択し、参加者全員が4項目IDと本体ハッシュを検証する利用までは禁止しない。公開配布の可否を表す別フィールドは将来のスキーマ更新で追加する。

## 8. 生成情報

```json
{
  "preset": "rolling",
  "parameters": {
    "elevation": 0.55,
    "density": 0.72,
    "platformCount": 2,
    "valleyDepth": 0.55,
    "mountainCount": 2,
    "symmetric": false,
    "destructibleRate": 1,
    "hardTerrainRate": 0,
    "cavityRate": 0.15,
    "smoothness": 0.72,
    "playerCount": 2,
    "difficulty": 0.5
  }
}
```

同じ`seed`, `generatorVersion`, `preset`, 正規化済み`parameters`の組み合わせは同じ地形と出撃地点を生成する。`random`指定時も、決定的PRNGにより同じ型へ解決される。

MVPで認識するプリセットキー：

`flat`, `rolling`, `plateauLeft`, `plateauRight`, `mountainCenter`, `valley`, `grandCanyon`, `centerHole`, `crater`, `stairs`, `symmetric`, `asymmetric`, `fortress`, `floatingIslands`, `platforms`, `cave`, `elevation`, `random`

## 9. プレビュー

JSON軽量形式では次のメタデータだけを格納する。

```json
{
  "mimeType": null,
  "width": 0,
  "height": 0,
  "data": null
}
```

MVPではJSON内への画像埋め込みに対応せず、`mimeType`/`data`は`null`、`width`/`height`は`0`のみを許可する。ZIPのプレビュー画像は読込み器でシグネチャ、寸法、MIME、容量を検査できるが、MVPのStage Studioは画像を生成・同梱しない。画像なしでもステージは完全に動作する。manifestと画像のメタデータ照合を追加するまで、プレビュー画像の正式同梱は将来仕様とする。

## 10. 正規化とcontentHash

全端末で同じ内容を同じハッシュにするため、次の順で正規化する。

1. 文字列長を上限へ収め、制御文字を除く。
2. 数値は有限値だけを許可する。地形座標と編集値は小数3桁、最終canonical JSON内の数値は小数6桁以内へ丸める。
3. 地形区間を各列で上端順へ並べる。
4. 出撃地点を`p1`, `e1`, `p2`, `e2`順へ並べる。
5. ギミックを`id`順へ並べる。
6. オブジェクトのキーを辞書順へ並べる。配列順は上記仕様を維持する。
7. `checksums.contentHash`を空文字にした正規化ステージを、キー辞書順のUTF-8 canonical JSONへシリアライズする。
8. SHA-256を小文字64桁の16進数へ変換し、`checksums.contentHash`へ格納する。

```json
{
  "algorithm": "SHA-256",
  "contentHash": "64桁の小文字16進数"
}
```

配布するJSONファイル自体は読みやすく整形してよい。ハッシュ計算時だけ必ず上記canonical JSONを使う。インポート時とバトル開始時に同じ手順で再計算し、ハッシュ不一致は警告扱いにせず、改変または破損として拒否する。

## 11. JSONファイル

- 文字コード: UTF-8
- MIME: `application/json`
- 最大サイズ: 2MiB
- ファイル名: タイトルをNFKC正規化し、危険文字、連続ドット、パス区切りを除いた最大64文字の名前 + `.stage.json`
- BOMは出力しない

ルートオブジェクト全体を1ファイルへ保存する。人が閲覧できるが、手編集後は必ず再検証とハッシュ再計算が必要。

## 12. ZIPバンドル

MVPのZIPは標準ZIPコンテナを使い、独自暗号化や実行ファイルを含めない。最低限の構成は次のとおり。

```text
manifest.json
terrain.json
gimmicks.json
preview.webp        # 任意
background.webp     # 将来の任意項目。MVPでは生成しない
assets/             # 将来の許可済み資産。MVPでは空
```

- `manifest.json`: 地形列とギミック配列を除くステージ本体、出撃地点、背景、ルール、ハッシュ。
- `terrain.json`: `terrain`と`materials`。
- `gimmicks.json`: `gimmicks`。
- インポート後に3つのJSONを正規ステージへ再構成し、スキーマと`contentHash`を検証する。
- ZIPライブラリへ任意コードを渡さず、MVPの出力は依存ゼロのSTORE方式を使用する。
- 圧縮後6MiB、解凍後12MiB、1エントリー6MiB、JSON 2MiB、画像4MiB、32エントリーを上限とする。
- CRC、重複名、切り詰めデータ、暗号化、データディスクリプター、対応外圧縮方式を検査する。
- 許可された相対パスだけを受け入れる。`..`、先頭`/`、ドライブ文字、NUL、バックスラッシュを拒否する。
- 画像を受け入れる場合は拡張子だけでなくWebP/PNG/JPEGのシグネチャを検査し、幅・高さ2048px、総画素4,194,304を上限とする。

## 13. 入力制限と拒否条件

次はエラーとしてインポートを中断する。

- JSON Schema不一致、対応外バージョン、互換性不一致
- 非有限数、範囲外座標、列数・区間数・オブジェクト数超過
- 出撃地点不足、重複、地形内部、画面外
- 未対応素材、背景、ギミック
- `__proto__`, `prototype`, `constructor`等の危険キー
- 深すぎるオブジェクト、長すぎる文字列、過大ファイル
- `javascript:`, `data:text/html`, `http:`, `https:`等のURL値
- ハッシュ不一致、破損ZIP、CRC不一致、ZIP Slip候補
- 任意コード、HTML、CSS、外部参照

公平性、高低差、崖との距離、薄い足場、複雑度は警告であり、ユーザーが意図した特殊ステージの保存を妨げない。

## 14. 移行

`shared/stage-core.js`は移行関数の境界を持つが、MVPで受け入れるのは`1.0.0`だけである。未知バージョンを推測で変換しない。将来移行を追加する場合も、移行後に再検証し、新しいSHA-256を生成してから保存する。
