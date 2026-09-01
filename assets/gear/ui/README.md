# Gear / LOADOUT UI assets

`master/` は差し替え・再調整用の原寸素材、`runtime/` はゲーム内で読み込む軽量素材です。

## Assets

- `gear_title_menu_frame_01`: タイトルの `LOADOUT` 専用メカニカルフレーム。文字はCanvasで描画し、画像へ焼き込まない。
- `gear_workbench_lab_background_01`: `CATAMON LAB` の背景。中央はGear UIを読ませるため暗く静かに保ち、研究設備は外周へ寄せる。

## Generation record

Built-in ImageGenで2026-09-01に生成し、実装前にユーザー確認済み。

- Title frame prompt: transparent mobile title-menu UI asset; one empty wide mechanical sign; dark gunmetal, aged brass and restrained gear accents; no text, parchment, wood, background or character.
- Lab background prompt: portrait 2:3 empty steampunk armory / research lab; black iron and aged brass detail around the edges; calm dark center for dense UI; no text, character, item card or neon sci-fi treatment.

`gear_title_menu_frame_01` は生成時の低alpha残像を除去し、透明余白を含む3.62:1のCanvasへ整形してあります。UI側で文字や状態を合成し、画像自体は装備authorityを持ちません。
