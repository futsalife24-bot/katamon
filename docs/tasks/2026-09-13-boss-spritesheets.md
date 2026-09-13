# 2026-09-13 協力ボスの8コマスプライト化

## 完成内容（ローカル実装、未コミット・未公開）

- BUILD `v2.0.183-boss-sprites`。要塞通常・要塞展開・ヴォルテリスを各8コマ、7fpsの描き分けへ変更。shear・96本の帯の伸縮を除去し、等比表示したセル1枚を切り替える。
- 味方準備から一斉攻撃解決完了までは従来の静止画・当たり判定に固定。画像未取得・サイズ不正も静止画へフォールバック。物理・通信仕様の変更なし。
- 部位表示はフレームごとの座標へ追従。要塞の第2フェーズにも専用8コマを使用。
- branch `feat/boss-spritesheets-20260913`。base / HEAD とも `77405209dc9a865d16b866fc3420ee694a35e6bd`。変更は未コミット。作業場所 `.codex-worktrees/boss-spritesheets-20260913`。ルートの既存実装差分は保護。

## 生成と素材

[ChatGPT生成チャット](https://chatgpt.com/c/6aa675f7-65f0-83e8-a3db-5a09130d3096)で原画3枚を添付し、各8コマを依頼。モデル名はGPT-Image 2.5を指定したが、実際のモデル名は画面では確認できない。

龍の欠けに対して再修正を依頼し、v4を採用。生成シートは不均等な行間なので、透明な隙間で切り出し、640px四方のセルへ平行移動して整列。再描画・引き伸ばし・端の消去は行っていない。翼・尾・足の全体を保持した。

- 正本: `assets/bosses/master/spritesheets/*-source.png`
- 切出しと移動記録: 同フォルダ `assembly.json`
- 再組立: `node tools/build-boss-sprites.cjs`（sharpが必要）
- 実行用: `assets/bosses/runtime/*-idle-atlas.webp`、各2560×1280、計約1.36MB
- コマ・部位データ: `shared/coop-boss-sprite-data.js`

## 検証

- `node tests/coop-boss-motion.test.js`: 2,086 assertions成功。8コマ・単一セル等比描画・欠読時静止・フェーズ・一斉必殺中固定・次準備の固定を確認。
- `coop-simultaneous.test.js` 34、`storm-boss-runtime.test.js` 28、`coop-live-boss.test.js` 32、`cache-version-test.js` 2、`undef-scan.js` 2: 成功。
- `node tests/coop-boss-sprite-assets.cjs`: 3枚24コマ、各コマの四辺完全透過、8種類の画素、部位座標のセル内収容を確認。sharpが必要。
- `node tests/coop-boss-motion-browser.cjs`: 実Chromiumで2ボスのドラッグ発射→ボス手番→次の味方準備、全8コマ、第2フェーズ、PC/390px幅、ブラウザ例外なしを確認。素材全体の画像確認は引いたカメラで実施。通常のズーム・パンによる画面外へのはみ出しは従来どおり。
- [画像・JSON証拠](2026-09-13-boss-sprites-evidence/)。`git diff --check`成功。

実機スマホ・本番複数人・公開後確認は未実施。公開とmergeは今回の依頼範囲に含めていない。

## 公開前の容量修正

初回CIは115件成功・1件失敗。iPhone WebKitのT3a取得量が47,518,110 bytesで45MiB上限を332,190 bytes超過。atlasのWebP qualityを92→80へ調整し、計1,883,310→1,360,406 bytes（522,904 bytes減）。解像度・8コマ・透過率・ゲームコードは維持。24コマ境界QA再成功。ローカルWebKit取得は配布元タイムアウトで実行できず、同じ容量E2EをGitHub CIで確認する。
