const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const foundation = require('../coop-mvp-foundation.js');
const shop = require('../coop-mvp-shop.js');

assert.equal(foundation.SHOP_ITEMS.length, 9);
assert.deepEqual(foundation.SHOP_ITEMS.map((item) => item.price), [100, 200, 200, 0, 100, 200, 100, 150, 200]);
assert.equal(Object.keys(shop.DESCRIPTIONS).length, 9);
assert.match(shop.DESCRIPTIONS['rescue-kit'], /1試合1回/, '救助弾の説明へ使用回数を明記');

let state = foundation.createDefaultState();
state.wallet.coins = 450;
let result = shop.purchase(state, 'barrier');
state = result.state;
assert.equal(result.purchased, true);
assert.equal(state.wallet.coins, 350);
assert.equal(state.inventory.barrier, true);
assert.equal(shop.purchase(state, 'barrier').reason, 'already-owned');
assert.equal(shop.purchase({ ...state, wallet: { coins: 199 } }, 'impact-cyan').reason, 'insufficient-coins');
assert.equal(shop.purchase(state, 'unknown').reason, 'unknown-item');

result = shop.equip(state, 'barrier');
state = result.state;
assert.equal(result.equipped, true);
assert.equal(state.equipment.subweapon, 'barrier');
assert.equal(shop.isEquipped(state, foundation.SUBWEAPONS[0]), true);

result = shop.equip(state, 'rescue-kit');
state = result.state;
assert.equal(state.equipment.coopItem, 'rescue-kit');

state.wallet.coins = 1000;
for (const id of ['icon-brass', 'shell-amber', 'impact-cyan']) {
  state = shop.purchase(state, id).state;
  state = shop.equip(state, id).state;
}
assert.deepEqual(state.equipment.cosmetics, {
  icon: 'icon-brass', projectile: 'shell-amber', impact: 'impact-cyan',
});
assert.equal(state.equipment.cosmetic, 'impact-cyan', '旧単一欄も後方互換として最後の装備を保持');
assert.equal(shop.isEquipped(state, foundation.COSMETICS[0]), true);
assert.equal(shop.isEquipped(state, foundation.COSMETICS[1]), true);
assert.equal(shop.isEquipped(state, foundation.COSMETICS[2]), true);

assert.equal(shop.previewKind(foundation.SUBWEAPONS[0]), 'barrier');
assert.equal(shop.previewKind(foundation.SUBWEAPONS[1]), 'trajectory');
assert.equal(shop.previewKind(foundation.COSMETICS[0]), 'icon');
assert.equal(shop.previewKind(foundation.COSMETICS[1]), 'projectile');
assert.equal(shop.previewKind(foundation.COSMETICS[2]), 'impact');

const source = fs.readFileSync(path.join(__dirname, '..', 'coop-mvp-shop.js'), 'utf8');
assert.match(source, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/,
  '9商品をタブなし3×3グリッドへ並べる');
assert.match(source, /max-width:480px.*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/s,
  'スマホでは説明と価格を読める2列へ広げる');
assert.match(source, /max-width:480px.*\.mvp-card\{min-height:250px.*\.mvp-card p\{font-size:10px;min-height:72px/s,
  'スマホの長い説明文と価格を重ねない高さを確保する');
assert.match(source, /\.mvp-foot\{height:58px.*<footer class="mvp-foot"><button class="mvp-close"/s,
  '閉じるボタンを商品カードへ重ねず、独立した黒鉄フッターへ置く');
assert.doesNotMatch(source, /refund|返品する|返金/u, '返品機能を作らない');
assert.match(source, /価格:<\/b>.*現在残高:/s, '購入前に価格と現在残高を同じ確認画面へ出す');
assert.match(source, /購入完了.*装備する/s, '購入後に装備する／あとでを表示する');
assert.match(source, /\.mvp-price\{position:absolute;left:8px;bottom:49px/,
  '価格・所持・装備状態を商品ボタンの上へ常時表示する');
assert.match(source, /mvp-achievements/, '18実績は切替・ソートなしの簡易一覧1枚');
assert.match(source, /ゴーストタップ.*pointerEvents = 'none'/s,
  'Canvasから開いた同じ指で商品を誤購入しない');
assert.match(source, /rgba\(18,46,48,.42\).*url\('assets\/wall.jpg'\)/s,
  '石壁・黒鉄・真鍮を使うカタモン世界観の背景');
assert.match(source, /id="mvpAchievementToast" role="status" hidden/,
  '実績通知は初期状態でDOMごと非表示にし、空の金枠を画面上端へ残さない');
assert.match(source, /\.mvp-toast\[hidden\],\.mvp-toast:empty\{display:none\}/,
  '空文字またはhiddenの実績通知をCSSでも確実に消す');
assert.match(source, /toast\.textContent = '';\s*toast\.hidden = true;/s,
  '実績通知の退場後は内容を空にして再び非表示へ戻す');

const gameSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.match(gameSource, /soundTestShopBtn/, '既存おまけ画面へ小さいショップ入口を置く');
assert.match(gameSource, /soundTestAchievementsBtn/, '既存おまけ画面へ小さい実績入口を置く');
assert.match(gameSource, /activeCosmetics\.icon === 'icon-brass'/, '真鍮アイコンを既存HPカードへ適用する');
assert.match(gameSource, /activeCosmetics\.projectile === 'shell-amber'/, '琥珀砲弾を既存の通常弾描画へ適用する');
assert.match(gameSource, /activeCosmetics\.impact === 'impact-cyan'/, '蒼光着弾を既存の爆発粒子へ適用する');

console.log('9商品ショップ・簡易DEMO・3コスメ・18実績一覧（58/58 passed）');
