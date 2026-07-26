# Firebase v3 rules — 移行済み

`database.rules.json` は **v3スキーマへ移行済み**。このチェックリストは
`tests/stage3test.js` の実行可能な検証(24項目、`rules ...` で始まるもの)に
置き換わったので、仕様の正本はそちらのコード。

```bash
node tests/stage3test.js
```

## ⚠️ デプロイ順序

**ルールとクライアントは必ず同時に上げること。** 片方だけだとオンライン対戦が全滅する。

| 状態 | 結果 |
|---|---|
| クライアントv3 + ルールv2 | 部屋の作成すら通らない(`protocol === 2` を要求され、未知のキーは `$other: false` で全拒否) |
| クライアントv2 + ルールv3 | 同上。逆向きに落ちる |

`tests/stage3test.js` の以下2つがこのズレを検知する。

- `database.rules.json uses the v3 room shape (rounds/slots)` — 旧スキーマなら理由付きで即停止
- `deployed rules protocol matches the client FIREBASE_PROTO_VERSION` — 数値のズレを検知

**ただしこれはリポジトリ内の一致しか見ない。Firebase Console へ実際に反映したかは検知できない。**
反映後は未認証アクセスが拒否されることを実測で確認すること。

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://katamon-online-default-rtdb.asia-southeast1.firebasedatabase.app/rooms.json"
# 401 なら既定拒否が効いている
```

## ルールが強制していること / していないこと

**強制している**
- 部屋は protocol 3、4枠(`p1`/`e1`/`s1`/`s2`)、現ラウンドは48桁hex
- 読み取りは着席済みメンバーかつ期限内のみ
- 1UIDが確保できる席は1つだけ。空席への確保はロビー中のみ。解放は自分の席のみ
- 設定変更・ラウンド状態変更・次ラウンド作成・部屋削除は `p1` のみ
- `s1`/`s2` は `presence`/`ping`/`bye` 以外を書けない
- 全パケットに `v:3` / 送信者UID / 自分の席 / 現ラウンドID。別ラウンドへは書けない
- `fire`/`state`/`result` の actionId と値域。`unitId` は送信者の席と一致必須
- メッセージログは追記専用(`!data.exists()`)

**強制していない(クライアント側の約束にとどまる)**
- **再戦は両者の投票後にのみ成立する** — 投票は保存された状態ではなくメッセージなので、
  ルールからは「両者が投票済み」を判定できない。`p1` は投票を待たずに次ラウンドを開ける
- 行動側権威そのもの。撃った側は原理的に結果を捏造できる(既知の許容事項)
