# 協力ボス戦の同時準備・一斉発射

- 状態: 実装・自己検証完了、PR #396で公開チェック中。
- 起点/base: 3d404d96867e98966b0f6595e4368404476765db（公開済みフォント修正版のmerge）。
- branch: feat/coop-simultaneous-20260912
- 作業場所: .codex-worktrees/coop-simultaneous-20260912
- BUILD_ID / CACHE_VERSION: v2.0.179-coop-salvo
- ルートおよび別worktreeの既存差分は維持。ルートの変更はCURRENT_WORK_STATE.mdへの今回の現在地追記だけ。

## 変更

味方の逐次行動を、全員共通30秒の同時移動・照準・READYへ変更。全員READYなら期限前に一斉発射し、期限切れの未READYは待機する。両ボス・ソロ＋AI・複数人に対応。

- index.html: 共同準備、席別AI計画、移動と確定、同時物理発射、既存の着弾後state/resultとの接続、残秒/READY表示。
- coop-mvp-battle.js: 協力専用packetの送信者・形状検証、サーバー時刻の受け渡し。両ボスのRTDBキー順と実地形下端・破壊跡の検証を統一。
- sw.js / 更新履歴 / cache-version-test: v2.0.179-coop-salvoへ整合。
- tests: 実エンジンのソロ、4独立プロセス＋実通信バリデータ、モバイルChromiumを追加。既存の逐次発射を期待した検査を更新。
- stage3testの固定8回待機は負荷時にSHA-256完了前の判定となったため、完了条件つき上限5秒の待機へ変更。本体の通常ONLINE処理は変更していない。

現行仕様は [同時行動仕様](../coop-simultaneous-actions.md)。従来の逐次入力仕様からの上書き関係も明記。

## 検証

- 新規の同時行動: 80項目（ソロ28、4独立プロセス各ボス26ずつ）成功。
- 同時移動、順不同READY、同一tick発射、30秒期限、全員待機、重複/過去巡回/他席/非有限値拒否、旧版拒否、複数必殺と実ダメージ収束、Phase 2、決着を確認。
- ソロではREADY後の移動禁止、ダウン/行動不能除外、回復・弱体化・SUBの使用権、撃破後も全弾解決してからリザルトへ進むことを確認。
- 既存回帰は分割で全コマンド成功。seat両席、pointercancel両席、regression両席各476、result93、loopback103、stage3 510、lobby7、back17、ranking7、静的識別子2、app-shell3、cache-version2、曜日ダンジョン/表示を確認。
- 協力戦/第2ボス関連10ファイルも成功（アイテム、ダウン救助、ボスAI、旧ラウンド、再戦、ロビー、テンポ、実戦統合、Storm domain/runtime）。
- Chromium 390×844: 実際の引いて離す操作、残秒・人数、AIの並行READY、4発同時、次巡回、期限を確認。pageerrorなし。物理スマホではない。
- 既存テストの初回ログには旧期待値による失敗が残る。修正後stage3以降の最終結果はremaining-regression.log、cache/曜日の最終成功は検証サマリーを参照。

## 公開チェック

- ユーザーの公開依頼に基づきPR #396を作成。実装commitは8590107262578cd6ac175bd80c2901ebb82cafab。
- 初回CIは本体npm test、Content StudioとAndroid E2Eが成功。全体mobile E2Eは115成功・20skip・1失敗。失敗はgame-shell.spec.jsの旧時間差発射期待値だけで、[0,0,0,0]へ修正後、同じケースをAndroid相当Chromiumで実行して成功（26.8秒）。ゲーム本体は変更なし。

## 証拠

- [機械可読検証サマリー](2026-09-12-coop-simultaneous-evidence/verification.json)
- [同時行動ログ](2026-09-12-coop-simultaneous-evidence/simultaneous.log)
- [既存回帰の前半](2026-09-12-coop-simultaneous-evidence/existing-regression.log)
- [既存回帰の後半](2026-09-12-coop-simultaneous-evidence/remaining-regression.log)
- [ブラウザ結果](2026-09-12-coop-simultaneous-evidence/browser-result.json)
- [準備画面](2026-09-12-coop-simultaneous-evidence/01-shared-preparation-mobile.png) / [発射画面](2026-09-12-coop-simultaneous-evidence/02-simultaneous-fire-mobile.png) / [READY待機](2026-09-12-coop-simultaneous-evidence/03-ready-wait-mobile.png)
- [コード・テストの差分](2026-09-12-coop-simultaneous-evidence/implementation.patch)

## 未実施・残る制約

- Firebase本番回線上の複数人プレイ、実機Android/iPhone、通信断・復帰の実回線検証、最終バランス調整は未実施。
- 700msの共通開始時刻を超える通信遅延では端末間の見た目に時間差が出る。全員の弾は各端末で同じ物理tickに生成し、結果はホストへ収束する。
- 通常ONLINE/Firebase Rules/保存schema/報酬契約は変更していない。公開・merge・本番変更は行っていない。
