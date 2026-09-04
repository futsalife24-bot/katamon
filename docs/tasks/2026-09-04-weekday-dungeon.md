# Task: 曜日ダンジョン MVP

- 状態: リリース候補（全自動検証完了）
- 更新日: 2026-09-04（JST）
- 対象ブランチ: `feat/weekday-dungeon-20260904`
- 起点: `origin/master` `72aff50c00e50b3f6063eed9d57a971646aec82e`

## 目的

通常のCPU連勝とは別に、1日1回だけ短時間で遊べるGear獲得導線を追加する。曜日ごとに対象部位を変え、CATAMONを毎日少し起動したくなる理由を、広告・課金・連続ログイン報酬なしで作る。

## 今回の確定仕様

- 判定日は端末タイムゾーンではなくJST固定。
- 月曜から土曜は、砲身・装甲・コア・動力・照準・補機の順で対象部位を固定する。
- 日曜だけ6部位から好きな部位を選べる。
- 入場、部位選択、照準、退出では挑戦を消費しない。FIRE前にattemptを保存・読戻しできた時だけ当日分を消費する。
- 専用の一発チャレンジで、命中時は対象部位Gearを1個、外れ時も粉末3を未受取報酬へ保存する。
- Gearは既存の未受取キュー、Web Lock、ledger、Drop Reveal、明示受取、Inventory / TEMP BOX振分けを再利用する。
- CPU連勝run、希少個体、資源箱、ONLINE、協力戦、Firebase、ランキングには接続しない。
- 専用背景1枚を生成し、曜日色・対象部位・霧・照準・命中演出はCanvasで描く。

## 生成背景

- 生成方式: Codex組み込みImageGen、`stylized-concept`
- master: `assets/weekday-dungeon/master/weekday_dungeon_vault_01.png`（941×1672）
- runtime: `assets/weekday-dungeon/runtime/weekday_dungeon_vault_01.jpg`（720×1280、約165KB）
- 最終プロンプト:

```text
Use case: stylized-concept
Asset type: portrait game environment background for CATAMON's daily Gear dungeon artillery stage
Input images: Image 1 is the composition and painterly fantasy-stage reference; Image 2 is the dark brass-and-black-iron Gear workshop material reference; Image 3 is the portrait depth, atmospheric mist, and clear center reference.
Primary request: create one original subterranean clockwork Gear vault, a mysterious once-per-day challenge chamber where a cannon shot disappears into dense luminous mist.
Scene/backdrop: vast underground forge-dungeon with black iron ribs, aged bronze machinery, chains, gauges, pipes, and a distant circular vault gate partly hidden by fog. Keep a broad unobstructed central play area for trajectory and characters.
Style/medium: highly polished painterly fantasy game environment, consistent with the supplied CATAMON stage references; detailed but readable on a phone.
Composition/framing: vertical 9:16, symmetrical side architecture framing an open center; horizon in the upper-middle; lower 40 percent comparatively dark and low-detail so destructible terrain and HUD remain readable; strong depth with no foreground objects blocking gameplay.
Lighting/mood: mysterious ceremonial daily challenge, dim warm amber forge lamps against restrained cyan-teal energy glow, layered volumetric fog across the center.
Color palette: black iron, aged brass, deep blue-green, small amber highlights; avoid dominant bright white.
Materials/textures: worn riveted metal, oxidized brass, soot, stone, soft mist.
Constraints: environment only; no characters, monsters, weapons, projectiles, Gear icons, UI, lettering, numbers, logos, borders, or watermark. No embedded text. Preserve generous clear negative space through the center. Original design, not a copy of the references.
Avoid: photorealistic photography, cartoon outlines, excessive bloom, cluttered center, giant foreground props, modern sci-fi screens.
```

## 既存企画との関係

`docs/実装計画_統合版.md`の固定シードチャレンジは「無報酬・取り逃しなし」を前提としている。2026-09-04のユーザー明示判断により、今回の曜日ダンジョンだけは別モードの1日1回Gear導線として追加する。固定シードチャレンジ本体の将来仕様は変更しない。

## 品質と報酬

- 命中後に追加の外れ抽選は行わない。
- ★: 1=35%、2=35%、3=20%、4=10%、5/6=0%。
- rarity: normal=40%、rare=34%、epic=20%、legend=5%、mythic=1%。
- セットは既存8種から均等。部位だけを当日対象へ固定する。
- 品質profileは`weekday-dungeon-v1`として独立させ、CPU報酬調整の影響を受けないようにする。

## 保存・復旧

- 専用key `katamon_gear_weekday_dungeon_v1` と専用Web Lockを使い、CPU中断保存とは分離する。
- attempt / reward / Gear IDはJST日付と対象部位から決定的に作る。
- FIRE直後、飛翔中、結果直後、報酬queue直後に閉じても、同じattemptから同じ結果と報酬を復旧する。
- 保存済み最大日より同日・過去日は再挑戦不可とし、時計巻戻しと同日複数タブを防ぐ。
- 完全オフラインでは、端末時計を未来へ進める操作とlocalStorage全消去を完全には防げない。サーバー時刻・ログインを入れないMVPの限界として明記する。

## 非対象

- 実機GOAL QA
- 通常戦闘のキャラ能力・Gear能力・弾道・風・地形の変更
- ONLINE protocol / wire / schema、Firebase Rules / Console
- 連続ログイン、取り逃し補填、通知、広告再挑戦、課金
- サーバー時刻の導入と完全な不正防止

## Plan

- [x] 曜日・一回性・弾道・報酬生成・保存復旧のpure moduleとREDテスト
- [x] GARAGE / Gear画面の入口と専用一発チャレンジUI
- [x] 生成背景のruntime最適化、PWA cache、BUILD / CACHE同期
- [x] 再読込・二重タブ・満杯・miss素材報酬・Drop Reveal受取のE2E
- [x] 全体テスト、実ブラウザ目視、Terra / Sol最終レビュー
- [ ] PR、master統合、GitHub Pages公開、本番version実値確認

## リリース前検証

- 曜日domain / storage: 9/9成功。
- UI静的契約: 13/13成功。320px幅の2列×3段、44px操作面、range入力、focus trap、遅延背景読込を確認した。
- Android Chromium / Mobile WebKit E2E: 8ケース×2環境の16/16成功。命中Gearの明示受取、miss粉末3、FIRE後queue前の再読込復旧、同日2タブ同時FIRE、未受取満杯、物理倉庫満杯、Gear WAL、Web Lock拒否、320×568のスクロール操作を実ブラウザで確認した。
- `npm test`: exit 0。既存回帰を含む全suite成功。
- `npm audit --omit=dev`: 0 vulnerabilities。
- Sol最終監査: release blockerなし。監査で見つかった保存中Tab trapのLow指摘もdocument-level trapへ修正し、focused testを再実行した。
- 生成背景のmasterは941×1672 / 2,161,228 bytes、runtimeは720×1280 / 164,536 bytes。ローカル実ブラウザの320×568表示で文字、操作面、中央の射線領域を目視確認した。
- ONLINE / Firebase、通常戦闘、CPU連勝、希少個体、資源箱は変更していない。実機GOAL QAは開始していない。

## 完成条件

- JST境界、全曜日、日曜選択、同日一回、時計巻戻しが自動テストで固定される。
- FIRE保存失敗時は発射も消費もせず、保存成功後は再読込しても同じ結果になる。
- 命中Gearは必ず対象部位、外れは粉末3で、どちらも一度だけ受け取れる。
- 未受取上限、物理倉庫満杯、Gear WAL、Web Lock競合をfail closedで案内する。
- CPU連勝・希少個体・資源箱・ONLINE / Firebaseへ差分が漏れない。
- Android Chromium / Mobile WebKit相当で入口から受取まで完走し、320px幅で操作が重ならない。
- 新moduleとruntime背景がPWA cacheへ入り、BUILD_IDとCACHE_VERSIONが一致する。
