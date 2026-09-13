# 協力ボス2体のアニメーション

- 状態: ローカル実装・自己検証済み、未コミット・未公開。
- 作業場所: `.codex-worktrees/coop-boss-animation-20260913`
- branch: `feat/coop-boss-animation-20260913`
- base / HEAD: `628b4f7cee6361c6f72b8c47bedeb1e45e76e5ae`（公開済みReady/Fire版）
- BUILD: `v2.0.181-boss-motion`

## 仕様と実装

1. 要塞戦車: 接地位置を維持し、上部が最大3px上下・1.8px左右に揺れる。排煙等も同じ演出時計を使用。
2. ヴォルテリス: 既存透明画像の翼側上部を96本の縦帯で連続的に伸縮し、羽ばたきと最大5pxの浮遊を描画。新しい画像や通信データは不要。
3. 部位マーカー・露出CORE・覚醒時の雷の接続先は、画像と共通の座標変換を使用。帯の中央で描画位置を近似するため、肩付近の画像と座標変換にはサブピクセル程度の差がある。
4. 味方の準備開始からReady/Fire・必殺演出・全弾と持続攻撃の解決完了まで、元画像の姿勢へ固定。ボスがactiveでも未完了salvoがあれば固定。次の味方準備でも即座に元の姿勢へ戻る。
5. アニメーションはボスの手番のみ進行。開始は0.35秒で振幅を増加。撃破・結果表示・再戦では停止／リセット。
6. 物理座標・部位判定・snapshot・ネットワーク契約は従来のまま。停止時は全クライアントで同じ姿勢なので命中判定と一致する。

## 変更ファイル

- `index.html`: 描画、共通停止判定、演出時計、再戦リセット。
- `sw.js`, `tests/cache-version-test.js`: BUILDの一致。
- `tests/seatharness.js`: テスト側だけの観測フック。
- `tests/coop-boss-motion.test.js`: 両ボス・全salvo段階・実必殺一斉発射・次巡回・状態非変更。
- `tests/coop-boss-motion-browser.cjs`: ローカルHTTPの実Chromium、実ドラッグ発射、固定／再開とPC・スマホ幅の撮影。
- `tests/README.md`, `CURRENT_WORK_STATE.md`, 本文書: 検証入口・現在地。

## 自己検証

- `node tests/coop-boss-motion.test.js`: 成功（最終実行1039 assertions。実戦の所要フレーム数により件数は変化）。
- `node tests/coop-simultaneous.test.js`: 34 passed。
- `node tests/storm-boss-runtime.test.js`: 28 passed。
- `node tests/coop-live-boss.test.js`: 32 passed。
- `node tests/coop-simultaneous-network.test.cjs` / 同 `storm-dragon-02`: 各26 passed（4独立プロセスの通信）。
- cache-version / undef-scan: 各2 passed。
- 実Chromium: 両ボスの通常一斉発射、ボス手番での再生、次準備の固定、ページエラー0。
- `git diff --check`: 成功。
- [ブラウザ結果・画像](2026-09-13-boss-motion-evidence/result.json)。同フォルダの各boss IDに対する `fixed` / `down` / `up` / `mobile` PNG。

## 残課題・境界

- 物理スマホでの描画負荷と見た目、本番Firebase複数人は未確認。4プロセス試験は本番接続の代替ではない。
- 別作業の未公開「灼鉄の包囲工廠」はこの枝へ統合していない。ルートと既存worktreeのコード変更は保護。
- merge、公開、外部Chatの独立監査は未実施。
