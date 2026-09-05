# Content Studio Phase 2 描画契約・監査記録

Base: 127d20ac46025e8b4fa4cefae91607af1189d5c1。新規isolated branch。実装開始GO、merge未承認。

## 実装前に固定する契約

- rendering.version=1。sourceFacingは編集反転適用後にStudio画面で指定した原画方向。画素への編集反転は生成時、世界方向への反転は描画時に一度だけ行う。旧metadataにrenderingがなければ静止表示。
- restBoundsは生成前の無変形画像のalpha>4領域（frame px）。union contentBoundsは動作の可視範囲だけ。groundはrestBoundsの底中央で、操作用groundPointや旧anchorとは別。
- 実静止画像の既存imageCrop内のalpha>4領域を一度測る。既存drawUnitの表示矩形へ写した身体範囲へ、restBoundsを固定X/Y倍率で合わせる。倍率はclip中不変。異なる被弾差分もその無変形範囲を同じ静止身体範囲へ合わせる。キャラ別の新しい補正値を作らない。groundOffsetYは静止表示矩形で一度だけ適用。
- 既存cropは静止側の基準計測だけに使用。sheet切出しはframe寸法×indexだけ。坂回転→原画と世界の向きの差による反転→固定身体矩形変換。HP/状態/オーラは元の位置。
- 128/256/384/512とも実metadata寸法を使用。Worker軽量代替の実寸法を保持。landはceil(0.48*(frameCount-1))をcontactFrameとし、その後のfootを生成時に接地させ、実着地からはcontactFrame以降だけ再生。
- 優先順位 hit > fire > land > walk > static。hit継続中の追加被弾は再開始しない（終了後の次の実被弾は再生）。上位non-loopのみ割込み。late loadはevent発生時計を保ち、終了済みを最初から再生しない。
- 通常単発成立だけfire。特殊/多段/支援/跳躍は既存演出維持。hitは確定ダメージ通知、実地上移動だけwalk、実落下・跳躍接地だけland。視覚情報をunit/snapshot/通信へ保存しない。
- 読込は必要clip単位。RGBA+処理中予約64MiB、同時要求共有、有限timeout、失敗はscene内再要求しない、LRU・最大entry数・epoch破棄。ブラウザ全RAM保証ではない。

## 非対象・保全

既存18体の定義・画像・能力・技、戦闘計算、通信payload/権威、Gear、Stage Studio、協力ボス専用描画は変更しない。既存worktree/backupを保持。旧outbox、実OAuth、master保護、実Android等のPhase 1残件を継承。

## 実装と接続箇所

- `shared/content-studio-motion.js`: `Player` はunit外のMapでイベントと歩行を保持。`frameAt` は経過msとmetadataからフレームを計算。既知イベントの終了後は歩行または静止へ戻る。同順位hitは継続中に再始動しない。読込中のイベントも開始時計を維持。
- `index.html`: `update` で歩行の当フレーム有効フラグを消し、`updateAfterPhysics` のlocal/CPU、`updateRemoteWalk` の実移動後にだけ再設定。`launchShot` の通常単発成立後にfire。特殊・連射・支援・跳躍の射撃演出は変更なし。
- `applyResolvedUnitDamage`、`fireworkShardExplode`、`damageGroundFlameTick`、`emitEmp` が実ダメージの候補を通知。remoteの再現計算は候補のみ。`applySnapshot` の受理後と既存結果処理の `flushRemoteDamageText` で実HP減少を確認し一度だけhit。replay検証中は通知しない。自傷コスト経路には通知を追加しない。
- `updateFalling` の実落下接地と `teleportOwnerToImpact` の跳躍接地でland。初期配置・地面追従は通知なし。跳躍弾所有者の非表示、協力ボス専用描画は従来分岐を維持。
- `drawUnit` 内、既存の接地点回転を適用した後に描画。HP/状態/オーラは元の処理。既存18体の静止画反転は不変。新規生成キャラの静止画だけはcatalog.facesLeftを描画上で参照し、world向きのunit値や `spriteFlipForFacing` は変更しない。
- `resetTransientBattleState`、snapshot適用、画面phase変更、visibility/pagehideで視覚状態と画像cacheを破棄。旧戦闘の非同期結果はepochとentry一致確認で破棄。

## 読込の上限

JSON 64KiB、深さ12、走査2000値、文字列512文字、PNG 6MiB、同時処理2件、entry32件、視覚unit16件、scene内失敗記録128件。timeout 10秒。許可されたslug/hash/clipの同一directory PNG/JSONだけをcredentials omit・redirect errorで読む。IHDRを確認してからデコードし、実寸法も照合。

RGBA予約+保持上限64MiB。うち2MiBを最大512×512の静止基準canvasとreadbackに確保。例えば512px・8枚=8MiB、12枚=12MiB（計算値）。PNG圧縮bytesやブラウザ全体のRAMの上限ではない。LRUでready bitmapをclose。キャンセル不能のデコードはtimeout後も容量・同時処理slotを完了まで保持するため、scene切替で予算を帳簿上だけ回復しない。処理が固まる場合は静止画fallbackを継続する。

## 試験の区別

- `battle-rendering.test.ts`: 実生成器、5clip×3強度×4寸法×左右、無変形範囲・接地suffix・非loop終端、旧形式fallback、immutable hashの25試験。
- `content-studio-motion.test.js`: ネットワーク/デコード境界fixtureの20試験。これは実PNG生成の代用ではない。
- `content-studio-motion-game.test.js`: 同じseed/入力で視覚ON/OFFの1vs1/2vs2を別processで比較。snapshot（地形を含む）と乱数回数・状態を比較。確定/remote候補/取消、射撃、着地、燃料0、remote歩行、resetを実関数経由で確認。
- `content-studio-motion.spec.js` と `fixtures/content-motion.ts`: Chromium上の実生成器・codec・buildArtifactBundleで試験専用PNG/JSON/canonical/catalogを作る。実ゲームHTMLへテスト応答内だけのフックを挿入。5clip、左右、坂、foot/scale、複数unit、404、期限切れ、再戦を検査。通常のシーン描画で連続5フレーム画像を保存。静的ファイル本体へ認証迂回やテストAPIを追加しない。
- root `pree2e` はStudio既存lockfileの依存を準備する入口。新依存なし。root CIの通常 `npm run e2e` でも生成器から接続を検証する。

## 残件・非対象

master保護未設定に伴うStudio自動merge停止、実OAuth/backend公開の本番完走、inputKeyなし旧outbox、実Android/実IME/メモリ圧迫/長時間復帰、初回監査backlog、既存依存監査警告は継続。新キャラ・本番モーションの一括制作は未実施。

Windows WebKitでStudio画像codecの `canvasToBlob` が `OffscreenCanvas` 未定義を参照する既存経路を今回の試験で確認。Phase 2はChromiumで生成した公開形式を両再生エンジンへ供給して分離検証する。codec対応は対象外backlog（受入条件: OffscreenCanvasなしでPNG/WebP出力形式を正しく扱い、Studio生成を実ブラウザで完走）。既存WebKit skipを解消済みとはしない。

ローカル試験の詳細ログと連続PNGはworktreeの `.phase2-evidence/` と `test-results/playwright/` に保持。外部監査用の最終実行結果・CI対象SHAはPR本文と引継ぎ報告を参照。Phase 2のmergeは未承認。


## 検証中に修正した再現ケース

- ONLINEの検証用replayがlive表示の被弾候補をresetする反例を追加。修正前exit 1（hitがnull）、replay中の表示reset/確定を抑止した後exit 0。物理・再生検証・通信の状態は変更しない。
- 既存 `firebase-online-battle-reentry-activation-phase3d8b3b2.test.js` の命中必須fixtureは、ランダムな地形にy=360の水平弾を撃っていた。Phase 2 headで通常撃破assert、base 127d20aでもLast Stand発火assertの失敗を確認した。初期fixtureだけを接地y=376の平地へ固定。実ゲームによる終端生成と撃破/Last Standのassertは維持し、期待値の緩和やskipを行わない。

- Chromiumの実画面試験にはCPUの通常射撃、演習1vs1/2vs2、協力戦4プレイヤーの描画と専用ボス除外も含む。360/390/412pxで3件成功。Windows WebKitも同じ3幅の生成物→描画試験が成功（生成はChromium）。実Android/IME確認ではない。
- rootブラウザ全体の初回は107 passed / 6 failed / 19既存skipped、exit 1。うち新規3件は生成環境と描画計測の切り分け後に上記再試験で成功。既存3件のWindows WebKit失敗は最終報告で切り分け結果を示し、全体PASSへ読み替えない。

- 持続炎が残りHPを超えるremoteダメージ候補を作り、権威側が被弾を否定した場合の反例も追加。修正前はhitを誤表示してexit 1、通知を実HP減少量へ限定してexit 0。元の減算・ダメージ表示・credit計算には変更なし。


## Phase 2-R1 / M1 — 失敗クリップの優先順位を解消

開始actualはmaster/base 127d20ac46025e8b4fa4cefae91607af1189d5c1、PR head 0c1e77e163f595f4b53a71ab776200b357ec9424。旧runtime blob 03297bdbf03ecf46ea718aa1c213bd500edb33edを照合し、復帰参照 backup/content-studio-p2-before-m1-0c1e77e を保存した。

- 原因: requestのnullが未完了と終端失敗を区別せず、失敗hitが仮duration 12000msの優先順位を保持していた。描画の抑止であり、戦闘計算や操作の停止ではない。
- AssetCache.statusは副作用なくpending/ready/failed/unavailableを返す。失敗記録上限に達しても既にreadyの正常assetは利用できる。fetch、decode、予約、timeout、LRU、resetの寿命処理は変更しない。
- Player.refreshEventをselectとnotifyの両方から呼び、終端失敗・利用不可・実duration終了を解消する。通知済み時刻を維持し、正常hitの優先順位・同順位再開抑止も維持する。失敗後の歩行には同じselectで復帰し、新規fire/landはselectに先行しても受理できる。
- index.htmlの変更はnotifyへCHARACTERS[u.character]を渡す1行のみ。通知が描画に先行しても、現在のclip参照とキャッシュ状態を照合するため。schema/version/向き/接地/固定倍率/戦闘/通信への変更はない。
- Nodeゲームharnessは通知試験用のclip参照を明示し、通信をfixture内へ閉じた。未登録を利用不可にする今回の動作に合わせたfixture補完で、既存の射撃・被弾・seeded一致assertを削除/緩和しない。
- 修正前: 実AssetCache+Playerの28試験中7失敗（404、不正metadata、旧形式、decode、timeout、path、新通知先行）。旧blobを供給した360px実ブラウザも、実移動delta成立後にclip未選択で失敗。修正後は追加境界を含む31 unit成功、同じ実ブラウザ3幅成功。
- ブラウザM1区間は開始時だけsceneを準備し、実被弾→hit PNG 404確定→実updateAfterPhysics移動→実launchShot通常単発と進む。既存draw()を使わず、Player・states Map・unitの表示state・cache epochがすべて同一のまま400ms以内に歩行/射撃frameが進むことを検査。hit PNGは1要求、歩行/射撃各3連続画像を保存する。フックと旧blob供給はテスト応答内だけ。

最終head・全コマンド・CI・成功/失敗/既存skipはPR本文と `.phase2-evidence/m1/` の報告へ記録する。Draft維持・再監査待ち。MERGE GOは未取得。既存backlogを維持。
