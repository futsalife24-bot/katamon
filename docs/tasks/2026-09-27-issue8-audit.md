# Issue #8 独立監査依頼資料

状態: **送信承認済み。初回独立監査FAIL、F1〜F4修正・再監査中**。[監査指摘と対応](2026-09-27-issue8-audit-corrections.md)。自己レビューをPASS扱いしない。IssueはOPEN、受入状態は **Awaiting manual / real-device acceptance**。merge・公開の承認は含まない。

## 対象を固定

- repo: `futsalife24-bot/katamon`
- branch: `codex/issue8-recovery-pc`
- base: `48a5182a7b6d27b4838e3b18d197fe08e79890a6`（開始時origin/master。PR作成前のremote確認も同一）
- 検証したcode/test HEAD: `60946bc1b3635b25eaafe7b37fe43edb621e29d6`
- 後続commitは、この監査資料・差分添付だけ。最終提出HEADはPR本文とIssueの報告へ記載する。
- [runtime/test差分](2026-09-27-issue8-evidence/runtime-tests.diff)。完全差分は上記baseからPR headまで。約1MBの証拠画像・ログとSTATEの古い節の移動をコード変更と混同しない。
- [Issue #8対応表・全結果・残課題](2026-09-27-issue8-recovery-pc.md)、[最終実機チェック表](2026-09-27-issue8-mobile-acceptance.md)。

## 既存masterのまま維持した部分

PR #333〜#340の同一試合re-entry/recovery、UID/room/seat確認、Web Lock、immutable startとfire/state/result履歴の実物理replay、候補snapshotの検証、最後のround fence、Gear runtime復元を使用する。ローカル表示値や古い `latestSnapshot` を権威へ昇格しない。

行動側がterminalを書き、受信側はround/seat/actionId/turn ownerと再現結果を検証する。決着のconcede例外は既存のまま。Firebase Rules、wire schema、Gear仕様、HP/攻撃/バランスは変更なし。途中観戦は後発仕様で廃止済み。2v2のs1/s2は観戦者ではなくp2/e2の操作席。

## 今回の差分と重点監査点

1. hostのbfcache退避でlive shell/leaseを壊さない。document置換の解放と、二重タブの排他を維持しているか。
2. transient pingだけを欠落許容とし、権威write・401/403・同じpush keyの別内容はfail-closed。JSON本文をenqueue時に固定して再送時の共有参照変更を防ぐ。権限エラーや行動送信を誤って握りつぶしていないか。
3. 完了state/resultの重複を受信時と適用時の両方で無害化し、完了IDをround全体で保持。履歴planも最初の候補を保持する。同じIDの別sender/unit/typeや、未知actionを誤って受理しないか。
4. 最終手番はstateを先送りせず、同じactionIdのresultを唯一のterminalとする。時間切れの勝者はreplayしたturn数とHP比から検証する。packetのreason/HPによる偽装を受理しないか。
5. room metadataがplayingのままでも、immutable resultはreplay必須の候補にできる。最終room/round fenceを弱めていないか。
6. 試合中のpresenceに返す不要なlobbyState通知を抑制する。ロビー/revealingで必要な通知、名簿の正本GETは残る。

## 実行証拠

- 指定6系統: seat 52、regression各席477、result 93、loopback 103、stage3 510、lobby 7。
- Recovery: B2/B3A/B3B1/B3B2/live = 13/13/14/19/16。F4/F5=4/3、Gear checkpoint/same-owner各5。transport 9ケース。版・STATE容量・未定義参照チェックも成功。19コマンドのexit=0は [results.json](2026-09-27-issue8-evidence/results.json)。
- F4 Chromium: 全体12成功、1件が終了時のPlaywright ZIP/stream破損で失敗。そのGear ONケースを単独再実行し成功。両方のログを保存。新規host bfcache、2v2 support、host/guest reload、結果復帰、native Lock競合を含む。
- [native Chromium受入JSON](2026-09-27-issue8-evidence/chromium-acceptance.json): 独立host/guest context、第三guestタブ、実Auth/RTDB emulator＋本物のRules＋native SSE。移動で位置/燃料変化、750ms PUT遅延、guest自動SSE再接続、host明示再接続、双方reload、旧transport拒否、旧action/stale snapshot無害化、旧round write 401、決着直前offline、正常決着、両者同一result reload、再戦を連続PASS。
- request timeout/network/408/429/503、権限拒否、lost-response再送はtransport試験。逆順terminal/fire・buffering・duplicate・遅延はlive/loopback回帰。
- red→green: host bfcache、ping queue、完了state、16件超のID保持、最終手番terminal、時間切れ受信、履歴重複、immutable retry。証拠ディレクトリのbefore/afterログを参照。
- loopback最終基準は78/89/128/89/89。途中の90は無変更baseで12回中4回再現（全228確認成功）。唯一の追加packetは最終state前のguest fire。既存legacy auto-special挙動として記録し、Issue #8へ別修正を混ぜていない。

## 未確認と境界

- WebKitはWindowsでpage/browserが終了し未確認。Chromiumのviewport変更を実機とは扱わない。
- 物理2端末、Android/iOS、画面ロック、OSによるprocess停止、通信経路切替、PWA/SW更新、production A〜Kは未確認。native harnessはSWをblockし、関数bridgeから実ゲームを動かすため全面的なpointer UI受入でもない。
- 行動側がterminal保存前に消えた場合、recoveryは未完tailを待つ。勝手に確定snapshot/resultを作らない既存境界を維持。
- Web Lockは同一originの協調的documentを排他する。別端末で同じUIDを悪用するclientのサーバー側失効や、既に送信中の要求の取消まで保証しない。新generation/Rules変更は本PR外。
- Meloso Judgeはworktreeと登録正本pathの不一致で固定/liveとも利用不可。report未作成、API送信なし。未判定を監査PASSとしない。
- 元正本のdirty branch/worktree、他project、Firebase Console、production DB、Rules、Pages、branch削除は変更なし。実model ID/effortは未確認、切替・サブエージェントなし。

## 監査者への依頼

上記code HEADと差分を確認し、Issue #8に直接関わるauthority/recoveryの破綻、正しい現clientを巻き込む拒否、result/turn境界の回帰があれば再現条件・該当行・重要度を示してください。既存境界を無断で新仕様へ変えず、仕様判断が必要なら分けてください。PASSの場合も物理端末と公開が未実施であることを保持してください。

通常ChatGPTへの送信はユーザー承認を得て実施済み。初回FAILを保存し、同じ監査目的の修正差分を再提出する。merge・公開の承認は別途。
