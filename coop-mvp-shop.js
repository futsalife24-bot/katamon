(function attachMvpShop(root, factory) {
  const foundation = typeof module === 'object' && module.exports
    ? require('./coop-mvp-foundation.js') : root?.KatamonCoopMvp;
  const rewards = typeof module === 'object' && module.exports
    ? require('./coop-mvp-rewards.js') : root?.KatamonCoopRewards;
  const api = factory(root, foundation, rewards);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonMvpShop = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMvpShop(root, foundation, rewards) {
  'use strict';

  const DESCRIPTIONS = Object.freeze({
    barrier: '次に受ける1回のダメージを半減する入門向け防具。',
    impact: '低〜中威力と大きなノックバックで位置を崩す砲弾。',
    drill: '低威力だが通常弾の2倍の範囲で地形を掘る砲弾。',
    'rescue-kit': 'ダウンした仲間を最大HP30%で戦線へ戻す救助弾。',
    'healing-kit': '生存中の他の仲間を最大HP30%回復する弾。',
    'debuff-grenade': '次の1ラウンドだけボスへの全ダメージを1.25倍。',
    'icon-brass': 'ロビーの自分表示へ添える真鍮の砲兵章。性能差なし。',
    'shell-amber': '通常砲弾を琥珀色へ替える外観。性能差なし。',
    'impact-cyan': '着弾の光を蒼色へ替える外観。性能差なし。',
  });
  const CATEGORY_LABELS = Object.freeze({ subweapon: 'SUB WEAPON', coop: 'CO-OP ITEM', cosmetic: 'COSMETIC' });

  function itemById(id) {
    return foundation.SHOP_ITEMS.find((entry) => entry.id === id) || null;
  }

  function categoryOf(item) {
    if (foundation.SUBWEAPONS.some((entry) => entry.id === item?.id)) return 'subweapon';
    if (foundation.COOP_ITEMS.some((entry) => entry.id === item?.id)) return 'coop';
    return 'cosmetic';
  }

  function purchase(currentState, itemId) {
    const state = foundation.normalizeState(currentState);
    const item = itemById(itemId);
    if (!item) return { state, purchased: false, reason: 'unknown-item' };
    if (state.inventory[item.id]) return { state, purchased: false, reason: 'already-owned' };
    if (state.wallet.coins < item.price) return { state, purchased: false, reason: 'insufficient-coins' };
    state.wallet.coins -= item.price;
    state.inventory[item.id] = true;
    return { state, purchased: true, reason: 'purchased', balance: state.wallet.coins, item };
  }

  function equip(currentState, itemId) {
    const state = foundation.normalizeState(currentState);
    const item = itemById(itemId);
    if (!item || !state.inventory[item.id]) return { state, equipped: false, reason: 'not-owned' };
    const category = categoryOf(item);
    if (category === 'subweapon') state.equipment.subweapon = item.id;
    else if (category === 'coop') state.equipment.coopItem = item.id;
    else {
      state.equipment.cosmetic = item.id;
      state.equipment.cosmetics[item.kind] = item.id;
    }
    return { state, equipped: true, reason: 'equipped', item };
  }

  function isEquipped(state, item) {
    const category = categoryOf(item);
    if (category === 'subweapon') return state.equipment.subweapon === item.id;
    if (category === 'coop') return state.equipment.coopItem === item.id;
    return state.equipment.cosmetics?.[item.kind] === item.id;
  }

  function previewKind(item) {
    if (!item) return 'none';
    if (item.kind === 'icon') return 'icon';
    if (item.kind === 'projectile') return 'projectile';
    if (item.kind === 'impact') return 'impact';
    if (categoryOf(item) === 'subweapon') return item.id === 'barrier' ? 'barrier' : 'trajectory';
    return 'support';
  }

  let mounted = false;
  let selectedItemId = null;
  let toastTimer = 0;

  function styleText() {
    return `
      #mvpCollection{position:fixed;z-index:140;inset:0;display:none;align-items:center;justify-content:center;padding:10px;box-sizing:border-box;background:radial-gradient(circle at 50% 32%,rgba(18,46,48,.42),rgba(2,5,7,.94) 72%),url('assets/wall.jpg') center/cover;font-family:var(--katamon-font-ui);color:#f5e6c3}
      #mvpCollection.open{display:flex}#mvpCollection *{box-sizing:border-box}
      .mvp-panel{position:relative;width:min(720px,100%);height:min(940px,98vh);overflow:hidden;border:2px solid #b8873c;clip-path:polygon(14px 0,calc(100% - 14px) 0,100% 14px,100% calc(100% - 14px),calc(100% - 14px) 100%,14px 100%,0 calc(100% - 14px),0 14px);background:linear-gradient(#1b292e,#0a1115 26%,#070b0e);box-shadow:0 18px 44px #000,inset 0 0 0 3px #29383d}
      .mvp-head{height:72px;padding:11px 68px 8px 18px;border-bottom:2px solid #785027;background:linear-gradient(#2b3a3f,#111b20);text-align:left}.mvp-head h2{margin:0;color:#ffd66f;font:900 20px/1.1 var(--katamon-font-display);letter-spacing:.06em;text-shadow:0 2px #000}.mvp-head p{margin:5px 0 0;color:#d6c39d;font-size:11px}.mvp-wallet{position:absolute;right:17px;top:14px;padding:8px 10px;border:1px solid #d49c3d;border-radius:4px;background:#0b1214;color:#ffd66f;font-weight:900}.mvp-foot{height:58px;display:flex;align-items:center;justify-content:flex-end;padding:8px 14px;border-top:1px solid #785027;background:linear-gradient(#111b20,#080d10)}.mvp-close{width:112px;min-height:40px;border:1px solid #a87536;background:#17252b;color:#f9e8c4;font-weight:900;clip-path:polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px)}
      .mvp-scroll{height:calc(100% - 130px);overflow:auto;padding:12px;overscroll-behavior:contain}.mvp-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.mvp-card{position:relative;min-height:220px;padding:9px 8px 8px;border:1px solid #6c4a29;border-radius:4px;background:linear-gradient(155deg,#33271e,#11191c 48%,#091013);box-shadow:inset 0 0 0 1px #27343a;text-align:left;color:#f5e6c3}.mvp-card.owned{border-color:#8caa8e}.mvp-card.equipped{box-shadow:inset 4px 0 #f2bd4c,inset 0 0 0 1px #3a4b4d}.mvp-cat{color:#c79850;font-size:8px;font-weight:900;letter-spacing:.1em}.mvp-card h3{margin:4px 0;color:#fff2ce;font-size:14px}.mvp-card p{min-height:46px;margin:0;color:#c7d0ca;font-size:10px;line-height:1.35}.mvp-price{position:absolute;left:8px;bottom:49px;color:#ffd66f;font-size:12px;font-weight:900}.mvp-owned{color:#9ed1a6}.mvp-card button{position:absolute;left:8px;right:8px;bottom:8px;min-height:33px;border:1px solid #b8873c;background:#1b2a30;color:#ffe4a7;font-weight:900}.mvp-card button:disabled{border-color:#445158;color:#879198;background:#10171a}
      .mvp-preview{height:68px;margin:0 0 7px;overflow:hidden;border:1px solid #4e5f64;background:radial-gradient(circle at 50% 70%,#304347,#091013 72%);position:relative}.mvp-preview::before{content:'';position:absolute;left:0;right:0;bottom:10px;height:11px;background:linear-gradient(#9a7450,#4e3828)}.mvp-orb{position:absolute;left:12%;top:48%;width:17px;height:17px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff3b8,#d98327 38%,#563110 72%);box-shadow:0 0 10px #ef9f39;animation:mvp-shot 1.8s ease-in-out infinite}.mvp-preview.trajectory .mvp-orb{animation-name:mvp-arc}.mvp-preview.impact .mvp-orb{left:47%;top:51%;background:#c9ffff;box-shadow:0 0 6px #68e8ff,0 0 18px #26a9d8;animation:mvp-pulse 1.25s ease-out infinite}.mvp-preview.icon .mvp-orb{left:calc(50% - 18px);top:12px;width:36px;height:36px;border:4px double #d5a33d;background:radial-gradient(#a44427,#282016);animation:none}.mvp-preview.barrier .mvp-orb{left:calc(50% - 22px);top:10px;width:44px;height:44px;background:transparent;border:4px solid #78d8e0;box-shadow:0 0 16px #4fc4d4,inset 0 0 14px #2a7b83;animation:mvp-pulse 1.6s infinite}.mvp-preview.support .mvp-orb{background:radial-gradient(#efffe9,#5bd487 45%,#1a7143);box-shadow:0 0 13px #55e892}
      @keyframes mvp-shot{50%{transform:translateX(230px)}}@keyframes mvp-arc{50%{transform:translate(230px,-42px)}}@keyframes mvp-pulse{0%{transform:scale(.4);opacity:1}100%{transform:scale(1.8);opacity:0}}
      .mvp-dialog{position:absolute;z-index:4;inset:0;display:none;align-items:center;justify-content:center;padding:22px;background:#020507dc}.mvp-dialog.open{display:flex}.mvp-dialog-card{width:min(430px,100%);padding:20px;border:2px solid #c8953e;background:linear-gradient(#26353a,#0b1215);box-shadow:0 14px 40px #000;text-align:center}.mvp-dialog-card h3{margin:0 0 10px;color:#ffd66f}.mvp-dialog-card p{font-size:12px;line-height:1.5}.mvp-dialog-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:15px}.mvp-dialog-actions button{min-height:44px;border:1px solid #b8873c;background:#17262c;color:#fbe7bd;font-weight:900}.mvp-dialog-actions .primary{background:#bd7b25;color:#fff8df;border-color:#ffd66f}
      .mvp-achievements{display:grid;gap:7px}.mvp-achievement{display:grid;grid-template-columns:1fr auto;gap:3px 10px;padding:10px;border:1px solid #4e6065;background:#0b1418}.mvp-achievement.done{border-color:#bd9145;background:linear-gradient(90deg,#272016,#0b1418 48%)}.mvp-achievement strong{color:#f6e4bb;font-size:13px}.mvp-achievement em{color:#d5a650;font-size:10px;font-style:normal}.mvp-achievement p{grid-column:1/-1;margin:2px 0;color:#b7c2bd;font-size:10px}.mvp-achievement span{font-size:10px}.mvp-toast{position:fixed;z-index:170;left:50%;top:18px;transform:translate(-50%,-120%);min-width:230px;max-width:calc(100% - 24px);padding:10px 14px;border:1px solid #e1ae50;background:#101a1ef2;color:#ffe5a5;text-align:center;font-weight:900;transition:transform .22s}.mvp-toast.show{transform:translate(-50%,0)}
      @media(max-width:480px){.mvp-panel{height:98vh}.mvp-head h2{font-size:17px}.mvp-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.mvp-card{min-height:250px;padding:7px 6px}.mvp-card h3{font-size:12px}.mvp-card p{font-size:10px;min-height:72px}.mvp-card button{left:6px;right:6px;font-size:10px}.mvp-preview{height:64px}@keyframes mvp-shot{50%{transform:translateX(100px)}}@keyframes mvp-arc{50%{transform:translate(100px,-30px)}}}
    `;
  }

  function markup() {
    return `<style id="mvpCollectionStyle">${styleText()}</style>
      <div id="mvpCollection" aria-hidden="true"><section class="mvp-panel" role="dialog" aria-modal="true" aria-labelledby="mvpCollectionTitle">
        <header class="mvp-head"><h2 id="mvpCollectionTitle">KATAMON WORKSHOP</h2><p id="mvpCollectionSubtitle">永久所持・返品不可</p><div class="mvp-wallet" id="mvpWallet">0 🪙</div></header>
        <main class="mvp-scroll" id="mvpCollectionBody"></main><footer class="mvp-foot"><button class="mvp-close" id="mvpCollectionClose" type="button">閉じる</button></footer>
        <div class="mvp-dialog" id="mvpPurchaseDialog"><div class="mvp-dialog-card" id="mvpPurchaseCard"></div></div>
      </section></div><div class="mvp-toast" id="mvpAchievementToast" role="status"></div>`;
  }

  function previewMarkup(item) {
    return `<div class="mvp-preview ${previewKind(item)}" aria-label="${item.label}の簡易プレビュー"><i class="mvp-orb"></i></div>`;
  }

  function renderShop() {
    const state = foundation.loadState();
    const body = document.getElementById('mvpCollectionBody');
    document.getElementById('mvpCollectionTitle').textContent = 'KATAMON WORKSHOP';
    document.getElementById('mvpCollectionSubtitle').textContent = '9商品・永久所持・返品不可';
    document.getElementById('mvpWallet').textContent = `${state.wallet.coins} 🪙`;
    body.innerHTML = `<div class="mvp-grid">${foundation.SHOP_ITEMS.map((item) => {
      const owned = state.inventory[item.id] === true;
      const equipped = owned && isEquipped(state, item);
      const price = item.price === 0 ? '初期所持' : `${item.price} 🪙`;
      return `<article class="mvp-card${owned ? ' owned' : ''}${equipped ? ' equipped' : ''}" data-item="${item.id}">
        <span class="mvp-cat">${CATEGORY_LABELS[categoryOf(item)]}</span><h3>${item.label}</h3>${previewMarkup(item)}
        <p>${DESCRIPTIONS[item.id]}</p><span class="mvp-price ${owned ? 'mvp-owned' : ''}">${equipped ? '装備中' : owned ? '所持済み' : price}</span>
        <button type="button" data-preview="${item.id}">${owned ? (equipped ? 'プレビュー' : '装備 / プレビュー') : '確認 / プレビュー'}</button></article>`;
    }).join('')}</div>`;
    body.querySelectorAll('[data-preview]').forEach((button) => button.addEventListener('click', () => openItem(button.dataset.preview)));
  }

  function renderAchievements() {
    const state = foundation.loadState();
    const rows = rewards.achievementRows(state);
    document.getElementById('mvpCollectionTitle').textContent = 'ACHIEVEMENTS';
    document.getElementById('mvpCollectionSubtitle').textContent = '全18実績・達成報酬は自動付与';
    document.getElementById('mvpWallet').textContent = `${state.wallet.coins} 🪙`;
    document.getElementById('mvpCollectionBody').innerHTML = `<div class="mvp-achievements">${rows.map((row) => `<article class="mvp-achievement${row.completed ? ' done' : ''}"><strong>${row.completed ? '✓ ' : ''}${row.name}</strong><em>${row.rarity}</em><p>${row.condition}</p><span>${row.value} / ${row.target}</span><span>報酬 ${row.reward} 🪙${row.claimed ? ' 受取済み' : row.completed ? ' 未受取あり' : ''}</span></article>`).join('')}</div>`;
  }

  function openItem(itemId) {
    const state = foundation.loadState();
    const item = itemById(itemId);
    if (!item) return;
    selectedItemId = item.id;
    const dialog = document.getElementById('mvpPurchaseDialog');
    const card = document.getElementById('mvpPurchaseCard');
    const owned = state.inventory[item.id] === true;
    card.innerHTML = `<h3>${item.label}</h3>${previewMarkup(item)}<p>${DESCRIPTIONS[item.id]}</p><p><b>価格:</b> ${item.price === 0 ? '初期所持' : `${item.price} 🪙`}<br><b>現在残高:</b> ${state.wallet.coins} 🪙</p><div class="mvp-dialog-actions"><button type="button" data-action="cancel">あとで</button><button type="button" class="primary" data-action="${owned ? 'equip' : 'buy'}">${owned ? '装備する' : '購入する'}</button></div>`;
    card.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => handleDialogAction(button.dataset.action)));
    dialog.classList.add('open');
  }

  function handleDialogAction(action) {
    const dialog = document.getElementById('mvpPurchaseDialog');
    if (action === 'cancel') { dialog.classList.remove('open'); return; }
    let state = foundation.loadState();
    if (action === 'buy') {
      const result = purchase(state, selectedItemId);
      if (!result.purchased) {
        showToast(result.reason === 'insufficient-coins' ? 'カタコインが足りません' : '購入できません');
        return;
      }
      state = foundation.saveState(result.state);
      const item = result.item;
      const card = document.getElementById('mvpPurchaseCard');
      card.innerHTML = `<h3>購入完了</h3>${previewMarkup(item)}<p>${item.label}を永久アンロックしました。</p><p>残高 ${state.wallet.coins} 🪙</p><div class="mvp-dialog-actions"><button type="button" data-action="cancel">あとで</button><button type="button" class="primary" data-action="equip">装備する</button></div>`;
      card.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => handleDialogAction(button.dataset.action)));
      renderShop();
      return;
    }
    if (action === 'equip') {
      const result = equip(state, selectedItemId);
      if (result.equipped) { foundation.saveState(result.state); showToast(`${result.item.label}を装備しました`); }
      dialog.classList.remove('open');
      renderShop();
    }
  }

  function open(mode) {
    if (!mounted) mount();
    const overlay = document.getElementById('mvpCollection');
    if (!overlay) return false;
    document.getElementById('mvpPurchaseDialog').classList.remove('open');
    if (mode === 'achievements') renderAchievements(); else renderShop();
    // Canvasのpointerdownから開くため、同じ指のpointerupが直下の商品を押す「ゴーストタップ」を遮断する。
    overlay.style.pointerEvents = 'none';
    overlay.classList.add('open'); overlay.setAttribute('aria-hidden', 'false');
    setTimeout(() => { overlay.style.pointerEvents = ''; }, 280);
    return true;
  }

  function close() {
    const overlay = root?.document?.getElementById('mvpCollection');
    if (!overlay) return;
    overlay.classList.remove('open'); overlay.setAttribute('aria-hidden', 'true');
  }

  function showToast(message) {
    const toast = root?.document?.getElementById('mvpAchievementToast');
    if (!toast) return;
    clearTimeout(toastTimer); toast.textContent = message; toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function notifyAchievements(ids) {
    const names = (ids || []).map((id) => rewards.ACHIEVEMENTS.find((entry) => entry.id === id)?.name).filter(Boolean);
    if (names.length) showToast(`実績達成: ${names.join(' / ')}`);
  }

  function mount() {
    if (mounted || !root?.document?.body) return false;
    root.document.body.insertAdjacentHTML('beforeend', markup());
    root.document.getElementById('mvpCollectionClose').addEventListener('click', close);
    root.document.getElementById('mvpCollection').addEventListener('click', (event) => { if (event.target.id === 'mvpCollection') close(); });
    mounted = true;
    return true;
  }

  if (root?.document && foundation?.isFeatureEnabled?.(root.location, null)) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
  }

  return Object.freeze({
    DESCRIPTIONS,
    itemById,
    categoryOf,
    purchase,
    equip,
    isEquipped,
    previewKind,
    mount,
    openShop: () => open('shop'),
    openAchievements: () => open('achievements'),
    close,
    notifyAchievements,
  });
});
