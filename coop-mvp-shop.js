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
    'rescue-kit': '1試合1回。ダウンした仲間を最大HP30%で戦線へ戻す救助弾。',
    'healing-kit': '生存中の他の仲間を最大HP30%回復する弾。',
    'debuff-grenade': '次の1ラウンドだけボスへの全ダメージを1.25倍。',
    'icon-brass': 'バトル中の自分ステータス枠へ添える真鍮の砲兵章。性能差なし。',
    'shell-amber': '通常砲弾を琥珀色へ替える外観。性能差なし。',
    'impact-cyan': '着弾の光を蒼色へ替える外観。性能差なし。',
  });
  const CATEGORY_LABELS = Object.freeze({ subweapon: 'SUB WEAPON', coop: 'CO-OP ITEM', cosmetic: 'COSMETIC' });
  const ITEM_ASSETS = Object.freeze({
    barrier: 'assets/shop/runtime/items/shop_item_barrier_01.webp',
    impact: 'assets/shop/runtime/items/shop_item_impact_01.webp',
    drill: 'assets/shop/runtime/items/shop_item_drill_01.webp',
    'rescue-kit': 'assets/shop/runtime/items/shop_item_rescue_01.webp',
    'healing-kit': 'assets/shop/runtime/items/shop_item_healing_01.webp',
    'debuff-grenade': 'assets/shop/runtime/items/shop_item_debuff_01.webp',
    'icon-brass': 'assets/shop/runtime/items/shop_item_icon_brass_01.webp',
    'shell-amber': 'assets/shop/runtime/items/shop_item_shell_amber_01.webp',
    'impact-cyan': 'assets/shop/runtime/items/shop_item_impact_cyan_01.webp',
  });
  // 商品画像は「所持品そのもの」。購入前に判断しやすいよう、別に実戦で起きることを
  // 表す小さな演出面を持つ。数値や発射ロジックはここへ複製しない。
  const PREVIEW_SCENES = Object.freeze({
    barrier: Object.freeze({ id: 'barrier', cue: '被弾時　ダメージ -50%' }),
    impact: Object.freeze({ id: 'impact', cue: '着弾で大きくノックバック' }),
    drill: Object.freeze({ id: 'drill', cue: '地形破壊　範囲 ×2' }),
    'rescue-kit': Object.freeze({ id: 'rescue', cue: 'DOWN → HP 30%で救助' }),
    'healing-kit': Object.freeze({ id: 'healing', cue: '仲間のHPを 30%回復' }),
    'debuff-grenade': Object.freeze({ id: 'debuff', cue: '1 ROUND　全ダメージ ×1.25' }),
    'icon-brass': Object.freeze({ id: 'icon', cue: 'バトル中の自分表示に装着' }),
    'shell-amber': Object.freeze({ id: 'amber', cue: '通常砲弾の外観を変更' }),
    'impact-cyan': Object.freeze({ id: 'cyan', cue: '着弾の光を蒼色へ変更' }),
  });

  function itemById(id) {
    return foundation.SHOP_ITEMS.find((entry) => entry.id === id) || null;
  }

  function categoryOf(item) {
    if (foundation.SUBWEAPONS.some((entry) => entry.id === item?.id)) return 'subweapon';
    if (foundation.COOP_ITEMS.some((entry) => entry.id === item?.id)) return 'coop';
    return 'cosmetic';
  }

  function assetPath(item) {
    return ITEM_ASSETS[item?.id] || '';
  }

  function previewScene(item) {
    return PREVIEW_SCENES[item?.id] || Object.freeze({ id: 'none', cue: '効果プレビューなし' });
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

  function purchaseLocked(itemId, options) {
    return foundation.mutateStateLocked((currentState) => purchase(currentState, itemId), options);
  }

  function equipLocked(itemId, options) {
    return foundation.mutateStateLocked((currentState) => equip(currentState, itemId), options);
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
  let dialogActionBusy = false;
  let toastTimer = 0;
  let toastCleanupTimer = 0;
  let livePreviewFrame = 0;

  function styleText() {
    return `
      #mvpCollection{position:fixed;z-index:140;inset:0;display:none;align-items:center;justify-content:center;padding:10px;box-sizing:border-box;background:radial-gradient(circle at 50% 32%,rgba(18,46,48,.42),rgba(2,5,7,.94) 72%),url('assets/wall.jpg') center/cover;font-family:var(--katamon-font-ui);color:#f5e6c3}
      #mvpCollection.open{display:flex}#mvpCollection *{box-sizing:border-box}
      .mvp-panel{position:relative;width:min(720px,100%);height:min(940px,98vh);overflow:hidden;border:2px solid #b8873c;clip-path:polygon(14px 0,calc(100% - 14px) 0,100% 14px,100% calc(100% - 14px),calc(100% - 14px) 100%,14px 100%,0 calc(100% - 14px),0 14px);background:linear-gradient(#1b292e,#0a1115 26%,#070b0e);box-shadow:0 18px 44px #000,inset 0 0 0 3px #29383d}
      .mvp-head{height:72px;padding:11px 68px 8px 18px;border-bottom:2px solid #785027;background:linear-gradient(#2b3a3f,#111b20);text-align:left}.mvp-head h2{margin:0;color:#ffd66f;font:900 20px/1.1 var(--katamon-font-display);letter-spacing:.06em;text-shadow:0 2px #000}.mvp-head p{margin:5px 0 0;color:#d6c39d;font-size:11px}.mvp-wallet{position:absolute;right:17px;top:14px;padding:8px 10px;border:1px solid #d49c3d;border-radius:4px;background:#0b1214;color:#ffd66f;font-weight:900}.mvp-foot{height:58px;display:flex;align-items:center;justify-content:flex-end;padding:8px 14px;border-top:1px solid #785027;background:linear-gradient(#111b20,#080d10)}.mvp-close{width:112px;min-height:40px;border:1px solid #a87536;background:#17252b;color:#f9e8c4;font-weight:900;clip-path:polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px)}
      .mvp-scroll{height:calc(100% - 130px);overflow:auto;padding:12px;overscroll-behavior:contain}.mvp-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.mvp-card{position:relative;min-height:294px;padding:10px 9px 8px;border:1px solid #6c4a29;border-radius:6px;background:linear-gradient(155deg,#33271e,#11191c 48%,#091013);box-shadow:inset 0 0 0 1px #27343a;text-align:left;color:#f5e6c3}.mvp-card.owned{border-color:#8caa8e}.mvp-card.equipped{box-shadow:inset 4px 0 #f2bd4c,inset 0 0 0 1px #3a4b4d}.mvp-cat{color:#c79850;font-size:8px;font-weight:900;letter-spacing:.1em}.mvp-card h3{margin:4px 0 7px;color:#fff2ce;font-size:14px}.mvp-card p{min-height:50px;margin:7px 0 0;color:#c7d0ca;font-size:10px;line-height:1.45}.mvp-price{position:absolute;left:9px;bottom:49px;color:#ffd66f;font-size:12px;font-weight:900}.mvp-owned{color:#9ed1a6}.mvp-card button{position:absolute;left:8px;right:8px;bottom:8px;min-height:33px;border:1px solid #b8873c;background:#1b2a30;color:#ffe4a7;font-weight:900}.mvp-card button:disabled{border-color:#445158;color:#879198;background:#10171a}
      .mvp-preview{height:122px;margin:0;overflow:hidden;border:1px solid #4e5f64;border-radius:4px;background:radial-gradient(circle at 50% 45%,#284148 0,#102125 49%,#080d10 78%);position:relative;isolation:isolate}.mvp-preview::before{content:'';position:absolute;z-index:-1;left:9%;right:9%;bottom:11px;height:10px;border-radius:50%;background:#0008;filter:blur(5px)}.mvp-preview::after{content:'';position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 16px #000,inset 0 0 0 1px #d0a35d22}.mvp-item-art{display:block;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 5px 5px #000b);transform:scale(.94)}.mvp-preview.support{background:radial-gradient(circle at 50% 43%,#20463a 0,#102421 47%,#080d10 78%)}.mvp-preview.impact{background:radial-gradient(circle at 50% 45%,#164958 0,#10252b 47%,#080d10 78%)}.mvp-preview.icon{background:radial-gradient(circle at 50% 45%,#4a3720 0,#1d1a14 48%,#080d10 78%)}
      /* 商品写真ではなく、戦闘中の変化を伝えるミニ実演。画像は識別用の小さな所持品札として残す。 */
      .mvp-effect-preview{background:linear-gradient(180deg,#1a3238 0 62%,#18271e 62% 70%,#0a1011 70%);cursor:pointer}.mvp-effect-preview .mvp-item-art{position:absolute;z-index:1;left:5px;top:5px;width:42px;height:42px;padding:3px;border:1px solid #b88b46;border-radius:5px;background:#0b1518e8;transform:none}.mvp-preview-title{position:absolute;z-index:3;left:51px;top:7px;right:31px;color:#f9e7b8;font-size:8px;font-weight:900;letter-spacing:.08em;text-shadow:0 1px #000}.mvp-preview-cue{position:absolute;z-index:4;left:7px;right:7px;bottom:5px;overflow:hidden;color:#f5d98d;font-size:8px;font-weight:900;letter-spacing:.02em;text-align:center;text-overflow:ellipsis;white-space:nowrap;text-shadow:0 1px 2px #000}.mvp-effect-preview .mvp-preview-replay{position:absolute;z-index:5;left:auto;right:5px;top:5px;bottom:auto;width:23px;height:23px;min-height:0;padding:0;border:1px solid #bc9049;border-radius:50%;background:#14252a;color:#ffe4a3;font-size:12px;line-height:1;cursor:pointer}.mvp-preview-replay:focus-visible{outline:2px solid #fff0ac;outline-offset:1px}.mvp-demo-unit{position:absolute;z-index:2;bottom:26px;width:17px;height:17px;border:2px solid #d7d2b6;border-radius:48% 48% 42% 42%;background:linear-gradient(135deg,#7cae84,#25483c);box-shadow:0 4px 0 #0007}.mvp-demo-unit::after{content:'';position:absolute;left:4px;top:3px;width:4px;height:4px;border-radius:50%;background:#fff0a4;box-shadow:6px 0 #fff0a4}.mvp-demo-ally{left:30%}.mvp-demo-target{right:24%;background:linear-gradient(135deg,#b55c43,#542722)}.mvp-demo-boss{right:18%;bottom:23px;width:27px;height:23px;border-radius:45% 45% 35% 35%;background:linear-gradient(135deg,#82608e,#291d35);border-color:#d5b5f2}.mvp-demo-boss::after{content:'BOSS';position:absolute;left:-5px;top:5px;color:#ffe9f7;font-size:6px;font-weight:900}.mvp-demo-shot{position:absolute;z-index:3;left:39%;bottom:33px;width:7px;height:7px;border-radius:50%;background:#ffc45b;box-shadow:0 0 9px 3px #ffae3d;animation:mvp-shot 3.1s ease-in-out infinite}.mvp-demo-impact{position:absolute;z-index:3;right:26%;bottom:27px;width:8px;height:8px;border:2px solid #ffd26b;border-radius:50%;opacity:0;animation:mvp-impact 3.1s ease-out infinite}.mvp-demo-shield{position:absolute;z-index:3;left:calc(30% - 11px);bottom:18px;width:39px;height:39px;border:2px solid #76e5e0;border-radius:50%;opacity:0;box-shadow:0 0 12px #53e7e0;animation:mvp-shield 3.1s ease-out infinite}.mvp-demo-beam{position:absolute;z-index:3;left:calc(30% + 4px);bottom:25px;width:9px;height:50px;background:linear-gradient(0deg,#5ef1aa00,#6af6b5c8,#d4ffe6);opacity:0;transform:translateY(12px);animation:mvp-beam 3.1s ease-in-out infinite}.mvp-demo-plus{position:absolute;z-index:4;left:calc(30% + 2px);bottom:52px;color:#dbffe6;font-size:22px;font-weight:900;opacity:0;animation:mvp-plus 3.1s ease-in-out infinite}.mvp-demo-drill{position:absolute;z-index:3;left:39%;bottom:32px;width:20px;height:9px;border:2px solid #edc16a;border-radius:8px 2px 2px 8px;background:repeating-linear-gradient(90deg,#80521b 0 3px,#f0b64d 3px 6px);transform-origin:center;animation:mvp-drill 3.1s linear infinite}.mvp-demo-crater{position:absolute;z-index:3;right:20%;bottom:23px;width:34px;height:9px;border-top:3px dashed #b37a42;border-radius:50%;opacity:0;animation:mvp-crater 3.1s ease-out infinite}.mvp-demo-debuff{position:absolute;z-index:3;right:15%;bottom:17px;width:42px;height:42px;border:2px solid #d692ff;border-radius:50%;box-shadow:0 0 15px #9d55ea;opacity:0;animation:mvp-debuff 3.1s ease-out infinite}.mvp-effect-preview .mvp-demo-unit,.mvp-effect-preview .mvp-demo-shot,.mvp-effect-preview .mvp-demo-impact,.mvp-effect-preview .mvp-demo-shield,.mvp-effect-preview .mvp-demo-beam,.mvp-effect-preview .mvp-demo-plus,.mvp-effect-preview .mvp-demo-drill,.mvp-effect-preview .mvp-demo-crater,.mvp-effect-preview .mvp-demo-debuff{display:none}.mvp-scene-barrier .mvp-demo-ally,.mvp-scene-barrier .mvp-demo-shield,.mvp-scene-impact .mvp-demo-ally,.mvp-scene-impact .mvp-demo-target,.mvp-scene-impact .mvp-demo-shot,.mvp-scene-impact .mvp-demo-impact,.mvp-scene-drill .mvp-demo-ally,.mvp-scene-drill .mvp-demo-target,.mvp-scene-drill .mvp-demo-drill,.mvp-scene-drill .mvp-demo-crater,.mvp-scene-rescue .mvp-demo-ally,.mvp-scene-rescue .mvp-demo-beam,.mvp-scene-rescue .mvp-demo-plus,.mvp-scene-healing .mvp-demo-ally,.mvp-scene-healing .mvp-demo-target,.mvp-scene-healing .mvp-demo-beam,.mvp-scene-healing .mvp-demo-plus,.mvp-scene-healing .mvp-demo-impact,.mvp-scene-debuff .mvp-demo-ally,.mvp-scene-debuff .mvp-demo-boss,.mvp-scene-debuff .mvp-demo-shot,.mvp-scene-debuff .mvp-demo-debuff,.mvp-scene-icon .mvp-demo-ally,.mvp-scene-icon .mvp-demo-shield,.mvp-scene-amber .mvp-demo-ally,.mvp-scene-amber .mvp-demo-target,.mvp-scene-amber .mvp-demo-shot,.mvp-scene-amber .mvp-demo-impact,.mvp-scene-cyan .mvp-demo-ally,.mvp-scene-cyan .mvp-demo-target,.mvp-scene-cyan .mvp-demo-shot,.mvp-scene-cyan .mvp-demo-impact{display:block}.mvp-scene-impact .mvp-demo-target{animation:mvp-knockback 3.1s ease-out infinite}.mvp-scene-rescue .mvp-demo-ally{background:#465658;border-color:#8a9895;animation:mvp-revive 3.1s ease-out infinite}.mvp-scene-healing .mvp-demo-target{background:linear-gradient(135deg,#80c991,#2d6346);border-color:#a9f6bf}.mvp-scene-healing .mvp-demo-beam{left:calc(76% - 4px)}.mvp-scene-healing .mvp-demo-plus{left:calc(76% - 6px)}.mvp-scene-healing .mvp-demo-impact{right:auto;left:calc(76% - 9px);border-color:#6cf0a0;box-shadow:0 0 12px #60eba0;animation:mvp-heal 3.1s ease-out infinite}.mvp-scene-debuff .mvp-demo-shot{background:#d282ff;box-shadow:0 0 10px 3px #a556e9}.mvp-scene-icon .mvp-demo-ally{left:50%;transform:translateX(-50%)}.mvp-scene-icon .mvp-demo-shield{left:calc(50% - 19px);border-color:#f0bd54;animation:mvp-shield 3.1s ease-out infinite}.mvp-scene-amber .mvp-demo-shot{background:#ffad39;box-shadow:0 0 10px 3px #f48a1d}.mvp-scene-cyan .mvp-demo-shot{background:#6ff0ff;box-shadow:0 0 10px 3px #33cce7}.mvp-scene-cyan .mvp-demo-impact{border-color:#7df4ff;box-shadow:0 0 14px #36d9f3}.mvp-effect-preview.is-replaying *{animation-delay:0s!important}.mvp-dialog-card .mvp-effect-preview{height:190px}.mvp-dialog-card .mvp-effect-preview .mvp-item-art{width:58px;height:58px}.mvp-dialog-card .mvp-preview-title{left:70px;top:11px;font-size:11px}.mvp-dialog-card .mvp-preview-cue{bottom:9px;font-size:11px}.mvp-dialog-card .mvp-demo-unit{bottom:39px;transform:scale(1.35);transform-origin:bottom}.mvp-dialog-card .mvp-demo-ally{left:31%}.mvp-dialog-card .mvp-demo-target{right:25%}.mvp-dialog-card .mvp-demo-boss{bottom:35px;transform:scale(1.35);transform-origin:bottom}.mvp-dialog-card .mvp-demo-shot{left:41%;bottom:51px;transform:scale(1.35)}.mvp-dialog-card .mvp-demo-impact{right:28%;bottom:42px;transform:scale(1.45)}.mvp-dialog-card .mvp-demo-shield{left:calc(31% - 15px);bottom:27px;transform:scale(1.4);transform-origin:bottom}.mvp-dialog-card .mvp-demo-beam{left:calc(31% + 5px);bottom:35px;transform:scale(1.3);transform-origin:bottom}.mvp-dialog-card .mvp-demo-plus{left:calc(31% + 2px);bottom:78px}.mvp-dialog-card .mvp-demo-drill{left:41%;bottom:50px;transform:scale(1.35);transform-origin:center}.mvp-dialog-card .mvp-demo-crater{right:22%;bottom:35px;transform:scale(1.4);transform-origin:bottom}.mvp-dialog-card .mvp-demo-debuff{right:17%;bottom:27px;transform:scale(1.4);transform-origin:bottom}
      @keyframes mvp-shot{0%,18%{transform:translateX(-20px);opacity:0}28%,56%{opacity:1}69%,100%{transform:translateX(58px);opacity:0}}@keyframes mvp-impact{0%,57%{transform:scale(.2);opacity:0}67%{opacity:1}85%,100%{transform:scale(4);opacity:0}}@keyframes mvp-shield{0%,18%{transform:scale(.5);opacity:0}30%,57%{opacity:.95}80%,100%{transform:scale(1.38);opacity:0}}@keyframes mvp-beam{0%,28%{opacity:0;transform:translateY(12px)}40%,63%{opacity:.9;transform:translateY(0)}78%,100%{opacity:0;transform:translateY(-8px)}}@keyframes mvp-plus{0%,38%{opacity:0;transform:translateY(8px)}48%,63%{opacity:1}82%,100%{opacity:0;transform:translateY(-10px)}}@keyframes mvp-drill{0%,17%{transform:translateX(-22px) rotate(0);opacity:0}28%,59%{opacity:1}68%,100%{transform:translateX(58px) rotate(760deg);opacity:0}}@keyframes mvp-crater{0%,57%{opacity:0;transform:scale(.2)}68%,83%{opacity:1;transform:scale(1.1)}100%{opacity:0;transform:scale(1.4)}}@keyframes mvp-debuff{0%,53%{opacity:0;transform:scale(.2)}65%{opacity:1;transform:scale(1)}83%,100%{opacity:0;transform:scale(1.35)}}@keyframes mvp-knockback{0%,60%{transform:translateX(0)}74%,88%{transform:translateX(16px)}100%{transform:translateX(0)}}@keyframes mvp-revive{0%,36%{transform:translateY(5px) rotate(75deg);filter:grayscale(1)}50%,82%{transform:translateY(0) rotate(0);filter:grayscale(0)}100%{transform:translateY(0)}}@keyframes mvp-heal{0%,38%{transform:scale(.2);opacity:0}50%,72%{opacity:1}100%{transform:scale(3.6);opacity:0}}
      @media(prefers-reduced-motion:reduce){.mvp-effect-preview *{animation:none!important}.mvp-demo-shot,.mvp-demo-impact,.mvp-demo-shield{opacity:.8}.mvp-demo-beam,.mvp-demo-plus,.mvp-demo-drill,.mvp-demo-crater,.mvp-demo-debuff{display:none}}
      .mvp-live-battle-preview{background:#05090b}.mvp-live-battle-preview::before{display:none}.mvp-live-battle-preview canvas{display:block;width:100%;height:100%;background:#05090b}.mvp-live-battle-preview .mvp-preview-cue{padding:3px 5px;border-radius:3px;background:#071014d9}.mvp-live-battle-preview .mvp-preview-replay{position:absolute;z-index:5;right:7px;top:7px;width:30px;height:30px;min-height:0;padding:0;border:1px solid #d3a34d;border-radius:50%;background:#102127e8;color:#ffe6a5;font-size:15px;line-height:1}.mvp-live-battle-preview.is-unavailable::after{content:'戦闘プレビューを準備できません';display:grid;place-items:center;position:absolute;inset:0;color:#f3d69b;font-size:11px;background:#091114}
      .mvp-dialog{position:absolute;z-index:4;inset:0;display:none;align-items:center;justify-content:center;padding:22px;background:#020507dc}.mvp-dialog.open{display:flex}.mvp-dialog-card{width:min(430px,100%);padding:20px;border:2px solid #c8953e;background:linear-gradient(#26353a,#0b1215);box-shadow:0 14px 40px #000;text-align:center}.mvp-dialog-card h3{margin:0 0 10px;color:#ffd66f}.mvp-dialog-card .mvp-preview{height:190px;margin-bottom:12px}.mvp-dialog-card p{font-size:12px;line-height:1.5}.mvp-dialog-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:15px}.mvp-dialog-actions button{min-height:44px;border:1px solid #b8873c;background:#17262c;color:#fbe7bd;font-weight:900}.mvp-dialog-actions .primary{background:#bd7b25;color:#fff8df;border-color:#ffd66f}
      .mvp-achievements{display:grid;gap:7px}.mvp-achievement{display:grid;grid-template-columns:1fr auto;gap:3px 10px;padding:10px;border:1px solid #4e6065;background:#0b1418}.mvp-achievement.done{border-color:#bd9145;background:linear-gradient(90deg,#272016,#0b1418 48%)}.mvp-achievement strong{color:#f6e4bb;font-size:13px}.mvp-achievement em{color:#d5a650;font-size:10px;font-style:normal}.mvp-achievement p{grid-column:1/-1;margin:2px 0;color:#b7c2bd;font-size:10px}.mvp-achievement span{font-size:10px}.mvp-toast{position:fixed;z-index:170;left:50%;top:18px;visibility:hidden;opacity:0;pointer-events:none;transform:translate(-50%,calc(-100% - 32px));min-width:230px;max-width:calc(100% - 24px);padding:10px 14px;border:1px solid #e1ae50;background:#101a1ef2;color:#ffe5a5;text-align:center;font-weight:900;transition:transform .22s,opacity .22s,visibility 0s linear .22s}.mvp-toast.show{visibility:visible;opacity:1;transform:translate(-50%,0);transition:transform .22s,opacity .22s}.mvp-toast[hidden],.mvp-toast:empty{display:none}
      @media(max-width:480px){.mvp-panel{height:98vh}.mvp-head h2{font-size:17px}.mvp-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.mvp-card{min-height:304px;padding:8px 7px}.mvp-card h3{font-size:12px}.mvp-card p{font-size:10px;min-height:72px}.mvp-card button{left:6px;right:6px;font-size:10px}.mvp-preview{height:112px}.mvp-dialog-card .mvp-preview{height:180px}}
    `;
  }

  function markup() {
    return `<style id="mvpCollectionStyle">${styleText()}</style>
      <div id="mvpCollection" aria-hidden="true"><section class="mvp-panel" role="dialog" aria-modal="true" aria-labelledby="mvpCollectionTitle">
        <header class="mvp-head"><h2 id="mvpCollectionTitle">KATAMON WORKSHOP</h2><p id="mvpCollectionSubtitle">永久所持・返品不可</p><div class="mvp-wallet" id="mvpWallet">0 🪙</div></header>
        <main class="mvp-scroll" id="mvpCollectionBody"></main><footer class="mvp-foot"><button class="mvp-close" id="mvpCollectionClose" type="button">閉じる</button></footer>
        <div class="mvp-dialog" id="mvpPurchaseDialog"><div class="mvp-dialog-card" id="mvpPurchaseCard"></div></div>
      </section></div><div class="mvp-toast" id="mvpAchievementToast" role="status" hidden></div>`;
  }

  function productPreviewMarkup(item) {
    return `<figure class="mvp-preview mvp-product-preview ${previewKind(item)}" aria-label="${item.label}の商品画像">
      <img class="mvp-item-art" src="${assetPath(item)}" alt="${item.label}" width="256" height="256" loading="lazy" decoding="async">
    </figure>`;
  }

  function previewMarkup(item) {
    const scene = previewScene(item);
    const previewLabel = item.id === 'icon-brass' ? 'バトル中の装着位置' : '実戦効果';
    return `<figure class="mvp-preview mvp-live-battle-preview ${previewKind(item)}" data-live-battle-preview="${item.id}" data-preview-scene="${scene.id}" aria-label="${item.label}の${previewLabel}プレビュー">
      <canvas width="540" height="304" aria-hidden="true"></canvas>
      <figcaption class="mvp-preview-cue">${scene.cue}</figcaption><button class="mvp-preview-replay" type="button" data-preview-replay aria-label="${item.label}の効果をもう一度再生">↻</button>
    </figure>`;
  }

  function stopLiveBattlePreview() {
    if (livePreviewFrame) root.cancelAnimationFrame(livePreviewFrame);
    livePreviewFrame = 0;
    root.KatamonWorkshopBattlePreview?.stop?.();
  }

  function bindPreviewReplay(container, item) {
    stopLiveBattlePreview();
    const preview = container.querySelector('[data-live-battle-preview]');
    const targetCanvas = preview?.querySelector('canvas');
    const bridge = root.KatamonWorkshopBattlePreview;
    if (!preview || !targetCanvas || !bridge?.start?.(item.id)) {
      preview?.classList.add('is-unavailable');
      return;
    }
    const mirrorFrame = () => {
      bridge.copyTo?.(targetCanvas);
      livePreviewFrame = root.requestAnimationFrame(mirrorFrame);
    };
    mirrorFrame();
    preview.querySelector('[data-preview-replay]')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      bridge.restart?.();
    });
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
        <span class="mvp-cat">${CATEGORY_LABELS[categoryOf(item)]}</span><h3>${item.label}</h3>${productPreviewMarkup(item)}
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
    bindPreviewReplay(card, item);
    card.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => handleDialogAction(button.dataset.action)));
    dialog.classList.add('open');
  }

  async function handleDialogAction(action) {
    const dialog = document.getElementById('mvpPurchaseDialog');
    if (dialogActionBusy) return;
    if (action === 'cancel') {
      stopLiveBattlePreview();
      dialog.classList.remove('open');
      return;
    }
    dialogActionBusy = true;
    dialog.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
      if (action === 'buy') {
        const result = await purchaseLocked(selectedItemId);
        if (!result.purchased) {
          showToast(result.reason === 'insufficient-coins' ? 'カタコインが足りません' : '購入できません');
          return;
        }
        const item = result.item;
        const card = document.getElementById('mvpPurchaseCard');
        card.innerHTML = `<h3>購入完了</h3>${previewMarkup(item)}<p>${item.label}を永久アンロックしました。</p><p>残高 ${result.state.wallet.coins} 🪙</p><div class="mvp-dialog-actions"><button type="button" data-action="cancel">あとで</button><button type="button" class="primary" data-action="equip">装備する</button></div>`;
        bindPreviewReplay(card, item);
        card.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => handleDialogAction(button.dataset.action)));
        renderShop();
        return;
      }
      if (action === 'equip') {
        const result = await equipLocked(selectedItemId);
        if (result.equipped) showToast(`${result.item.label}を装備しました`);
        stopLiveBattlePreview();
        dialog.classList.remove('open');
        renderShop();
      }
    } catch (_error) {
      showToast('保存できませんでした');
    } finally {
      dialogActionBusy = false;
      dialog.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    }
  }

  function open(mode) {
    if (!mounted) mount();
    const overlay = document.getElementById('mvpCollection');
    if (!overlay) return false;
    stopLiveBattlePreview();
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
    stopLiveBattlePreview();
    root.document.getElementById('mvpPurchaseDialog')?.classList.remove('open');
    overlay.classList.remove('open'); overlay.setAttribute('aria-hidden', 'true');
  }

  function showToast(message) {
    const toast = root?.document?.getElementById('mvpAchievementToast');
    if (!toast) return;
    clearTimeout(toastTimer);
    clearTimeout(toastCleanupTimer);
    const text = String(message || '').trim();
    toast.classList.remove('show');
    if (!text) {
      toast.textContent = '';
      toast.hidden = true;
      return;
    }
    toast.textContent = text;
    toast.hidden = false;
    // hidden解除と同じ描画フレームでshowを付けると、端末によって登場アニメが省略される。
    // 一度レイアウトを確定させ、表示中だけ画面内へ降ろす。
    toast.getBoundingClientRect();
    toast.classList.add('show');
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
      toastCleanupTimer = setTimeout(() => {
        if (toast.classList.contains('show')) return;
        toast.textContent = '';
        toast.hidden = true;
      }, 240);
    }, 2600);
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
    ITEM_ASSETS,
    PREVIEW_SCENES,
    itemById,
    categoryOf,
    assetPath,
    purchase,
    equip,
    purchaseLocked,
    equipLocked,
    isEquipped,
    previewKind,
    previewScene,
    mount,
    openShop: () => open('shop'),
    openAchievements: () => open('achievements'),
    close,
    notifyAchievements,
  });
});
