const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const foundation = require('../coop-mvp-foundation.js');
const shop = require('../coop-mvp-shop.js');

assert.equal(foundation.SHOP_ITEMS.length, 9);
assert.deepEqual(foundation.SHOP_ITEMS.map((item) => item.price), [100, 200, 200, 0, 100, 200, 100, 150, 200]);
assert.equal(Object.keys(shop.DESCRIPTIONS).length, 9);
assert.deepEqual(Object.keys(shop.PREVIEW_SCENES), foundation.SHOP_ITEMS.map((item) => item.id),
  '全商品に購入判断用のeffect previewを持たせる');
assert.equal(shop.previewScene({ id: 'barrier' }).cue, '被弾時　ダメージ -50%');
assert.equal(shop.previewScene({ id: 'debuff-grenade' }).cue, '1 ROUND　全ダメージ ×1.25');
assert.equal(shop.previewScene({ id: 'unknown' }).id, 'none');
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
assert.match(source, /max-width:480px.*\.mvp-card\{min-height:304px.*\.mvp-card p\{font-size:10px;min-height:72px/s,
  'スマホの商品画像・長い説明文・価格を重ねない高さを確保する');
assert.match(source, /\.mvp-foot\{height:58px.*<footer class="mvp-foot"><button class="mvp-close"/s,
  '閉じるボタンを商品カードへ重ねず、独立した黒鉄フッターへ置く');
assert.doesNotMatch(source, /refund|返品する|返金/u, '返品機能を作らない');
assert.match(source, /価格:<\/b>.*現在残高:/s, '購入前に価格と現在残高を同じ確認画面へ出す');
assert.match(source, /購入完了.*装備する/s, '購入後に装備する／あとでを表示する');
assert.match(source, /\.mvp-price\{position:absolute;left:9px;bottom:49px/,
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
assert.match(source, /async function handleDialogAction\(action\)/,
  '購入・装備のUI経路をasync化する');
assert.match(source, /if \(dialogActionBusy\) return;.*dialogActionBusy = true;.*finally \{\s*dialogActionBusy = false;/s,
  '二重タップはbusy guardで同じ操作を二重開始しない');
assert.doesNotMatch(source, /function handleDialogAction[\s\S]*?foundation\.saveState\(/,
  'ショップUIから古いfoundation stateを直接保存しない');

const gameSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.match(gameSource, /const titleShopBtn = /, 'タイトルGARAGEへ独立したショップ入口を置く');
assert.match(gameSource, /const titleAchievementsBtn = /, 'タイトルGARAGEへ独立した実績入口を置く');
assert.doesNotMatch(gameSource, /soundTestShopBtn|soundTestAchievementsBtn/,
  'サウンドテスト内へショップ・実績を同居させない');
assert.match(gameSource, /activeCosmetics\.icon === 'icon-brass'/, '真鍮アイコンを既存HPカードへ適用する');
assert.match(gameSource, /activeCosmetics\.projectile === 'shell-amber'/, '琥珀砲弾を既存の通常弾描画へ適用する');
assert.match(gameSource, /activeCosmetics\.impact === 'impact-cyan'/, '蒼光着弾を既存の爆発粒子へ適用する');

class FakeStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

function createLockManager() {
  let tail = Promise.resolve();
  return {
    request(name, options, callback) {
      assert.equal(name, foundation.STATE_MUTATION_LOCK_NAME);
      assert.deepEqual(options, { mode: 'exclusive' });
      const current = tail.then(() => callback({ name, mode: 'exclusive' }));
      tail = current.catch(() => {});
      return current;
    },
  };
}

async function runLockedWriterTests() {
  const storage = new FakeStorage();
  const lockManager = createLockManager();
  const initial = foundation.createDefaultState();
  initial.wallet.coins = 500;
  foundation.saveState(initial, storage);

  const staleBeforePurchase = foundation.loadState(storage);
  const newerBeforePurchase = foundation.loadState(storage);
  newerBeforePurchase.wallet.coins = 600;
  foundation.saveState(newerBeforePurchase, storage);
  const purchaseResult = await shop.purchaseLocked('barrier', { storage, lockManager });
  assert.equal(purchaseResult.purchased, true);
  assert.equal(purchaseResult.state.wallet.coins, 500,
    '購入はlock内で最新coinを読み、確認画面時点の古い残高を保存しない');
  assert.equal(staleBeforePurchase.wallet.coins, 500, 'テスト用の確認画面snapshotは古いまま');

  const concurrent = await Promise.all([
    shop.purchaseLocked('impact', { storage, lockManager }),
    shop.purchaseLocked('impact', { storage, lockManager }),
  ]);
  assert.equal(concurrent.filter((entry) => entry.purchased).length, 1,
    '別タブ相当の同時購入でも購入済みitemを再購入しない');
  assert.equal(foundation.loadState(storage).wallet.coins, 300,
    '別タブ相当の同時購入でもcoinを二重減算しない');

  const staleBeforeEquip = foundation.loadState(storage);
  const newerBeforeEquip = foundation.loadState(storage);
  newerBeforeEquip.wallet.coins = 375;
  foundation.saveState(newerBeforeEquip, storage);
  const equipResult = await shop.equipLocked('barrier', { storage, lockManager });
  assert.equal(equipResult.equipped, true);
  const equipped = foundation.loadState(storage);
  assert.equal(equipped.equipment.subweapon, 'barrier');
  assert.equal(equipped.wallet.coins, 375,
    '装備変更もlock内で最新stateを再読込し、古いwalletで上書きしない');
  assert.equal(staleBeforeEquip.wallet.coins, 300, '装備前snapshotが古い競合条件を確認');
}

runLockedWriterTests().then(() => {
  console.log('9商品ショップ・簡易DEMO・3コスメ・18実績一覧・共通lock writer（68/68 passed）');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
