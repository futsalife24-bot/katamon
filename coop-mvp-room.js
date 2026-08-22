(function initKatamonCoopRoom(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonCoopRoom = api;
  if (root?.document) setTimeout(() => api.initBrowser(root), 0);
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonCoopRoom() {
  'use strict';

  const ROOM_PROTOCOL = 1;
  const SEATS = Object.freeze(['p1', 'e1', 's1', 's2']);
  const GUEST_SEATS = Object.freeze(['e1', 's1', 's2']);
  const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const ROOM_CODE_LENGTH = 8;
  const ROOM_TTL_MS = 10 * 60 * 1000;
  const LIST_LIMIT = 24;
  const CHARACTER_FALLBACK = 'kyoryu';
  const COOP_ITEM_IDS = new Set(['rescue-kit', 'healing-kit', 'debuff-grenade']);
  const SUBWEAPON_IDS = new Set(['barrier', 'impact', 'drill']);
  const DIFFICULTY_IDS = new Set(['normal', 'hard', 'extreme']);
  let browserOpenHandler = null;

  function normalizeRoomCode(value) {
    return String(value || '').toUpperCase().split('')
      .filter((character) => ROOM_ALPHABET.includes(character)).join('').slice(0, ROOM_CODE_LENGTH);
  }

  function isRoomCode(value) {
    return typeof value === 'string'
      && new RegExp(`^[${ROOM_ALPHABET}]{${ROOM_CODE_LENGTH}}$`).test(value);
  }

  function cleanText(value, maxLength, fallback = '') {
    const text = String(value || '').replace(/<[^>]*>/g, '').replace(/[\r\n\t]/g, ' ')
      .replace(/\s{2,}/g, ' ').trim().slice(0, maxLength);
    return text || fallback;
  }

  function normalizeSlot(value, context = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const characterIds = Array.isArray(context.characterIds) && context.characterIds.length
      ? context.characterIds : [CHARACTER_FALLBACK];
    const inventory = context.inventory && typeof context.inventory === 'object' ? context.inventory : {};
    const character = characterIds.includes(source.character) ? source.character : characterIds[0];
    const owns = (id) => context.enforceInventory !== true || inventory[id] === true;
    const subweapon = SUBWEAPON_IDS.has(source.subweapon) && owns(source.subweapon) ? source.subweapon : null;
    const coopItem = COOP_ITEM_IDS.has(source.coopItem) && owns(source.coopItem)
      ? source.coopItem : 'rescue-kit';
    return {
      uid: typeof source.uid === 'string' ? source.uid.slice(0, 128) : '',
      name: cleanText(source.name, 12, 'ななし'),
      character,
      subweapon,
      coopItem,
      ready: source.ready === true,
      claimedAt: Number.isFinite(Number(source.claimedAt)) ? Number(source.claimedAt) : 0,
      seenAt: Number.isFinite(Number(source.seenAt)) ? Number(source.seenAt) : 0,
    };
  }

  function applyEquipmentChange(slot, equipment) {
    const current = slot && typeof slot === 'object' ? slot : {};
    const next = {
      ...current,
      character: equipment?.character ?? current.character,
      subweapon: equipment?.subweapon ?? null,
      coopItem: equipment?.coopItem ?? current.coopItem,
    };
    const changed = next.character !== current.character
      || next.subweapon !== current.subweapon
      || next.coopItem !== current.coopItem;
    if (changed) next.ready = false;
    return next;
  }

  function canHostStart(slots, settings) {
    const occupied = SEATS.map((seat) => slots?.[seat]).filter((slot) => slot?.uid);
    if (!occupied.length || occupied.some((slot) => slot.ready !== true)) return false;
    return settings?.aiFill === true || occupied.length >= 2;
  }

  function sourceNamespaces() { return 'coopOpen/coopRooms'; }

  function usableListing(code, value, now) {
    return isRoomCode(code) && value && typeof value === 'object'
      && typeof value.hostUid === 'string' && value.hostUid.length > 0
      && typeof value.hostName === 'string' && value.hostName.length > 0
      && typeof value.roomName === 'string' && value.roomName.length > 0
      && Number.isInteger(value.playerCount) && value.playerCount >= 1 && value.playerCount <= 4
      && DIFFICULTY_IDS.has(value.difficulty)
      && Number.isFinite(value.expiresAt) && value.expiresAt > now;
  }

  function initBrowser(browserRoot) {
    const foundation = browserRoot.KatamonCoopMvp;
    const bridge = browserRoot.KatamonCoopBridge;
    if (!foundation || !bridge || !foundation.isFeatureEnabled(browserRoot.location, browserRoot.KATAMON_FEATURES)) return false;
    if (browserRoot.document.getElementById('coopBossLobby')) return true;

    const document = browserRoot.document;
    const progress = foundation.loadState();
    const characters = bridge.getCharacters();
    const characterIds = characters.map((entry) => entry.id);
    let session = null;
    let busy = false;
    let pollTimer = 0;
    let heartbeatTimer = 0;

    const style = document.createElement('style');
    style.textContent = `
      #coopBossLobby{position:fixed;inset:0;z-index:28;display:none;justify-content:center;background:linear-gradient(#020609c7,#020609f2),url('assets/wall.jpg') center/cover;font-family:var(--katamon-font-ui);color:#fff5dc}
      #coopBossLobby.open{display:flex}#coopBossLobby.busy button,#coopBossLobby.busy select,#coopBossLobby.busy input{pointer-events:none;opacity:.55}
      .coop-shell{width:100%;max-width:560px;height:100%;display:flex;flex-direction:column;overflow:hidden;background:linear-gradient(180deg,#37464df5,#15252bf8 46%,#070b0dfa);border-inline:2px solid #c7833588;box-sizing:border-box}
      .coop-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:max(14px,env(safe-area-inset-top)) 16px 12px;border-bottom:2px solid #c78335;background:linear-gradient(180deg,#4a3425,#25170e 55%,#100a06);box-shadow:0 5px 18px #0007}
      .coop-head h2{margin:0;color:#ffe2a1;font:400 20px var(--katamon-font-display);letter-spacing:.08em;text-shadow:0 2px #160b04}
      .coop-head button,.coop-button{min-height:42px;border:2px solid #c78335;border-radius:4px;color:#ffe2a1;background:linear-gradient(180deg,#37464d,#091116);font:400 14px var(--katamon-font-ui);cursor:pointer}
      .coop-body{flex:1;min-height:0;overflow-y:auto;padding:16px;box-sizing:border-box}.coop-kicker{margin:0 0 10px;color:#f4bf4f;font:400 12px var(--katamon-font-display);letter-spacing:.12em}
      .coop-card{margin:0 0 12px;padding:12px;border:1px solid #c7833588;border-radius:5px;background:linear-gradient(180deg,#34281899,#081014e6);box-shadow:inset 0 0 18px #0006}
      .coop-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.coop-grid .wide{grid-column:1/-1}.coop-card input,.coop-card select{width:100%;min-width:0;min-height:42px;box-sizing:border-box;padding:8px;color:#fff5dc;background:#081014;border:1px solid #c78335;border-radius:4px;font:400 14px var(--katamon-font-ui)}
      .coop-primary{min-height:56px!important;border-color:#ffe9a8!important;color:#2a1706!important;background:linear-gradient(180deg,#ffdf95,#f0a92e 52%,#c2701a)!important;font-size:17px!important}.coop-primary:disabled{opacity:.35!important;box-shadow:none}
      .coop-entry[hidden],.coop-room[hidden]{display:none}.coop-code{color:#ffd24a;font:400 22px var(--katamon-font-display);letter-spacing:.14em}.coop-note,.coop-status{font-size:12px;line-height:1.55;color:#aebbc5}.coop-status{min-height:2.8em;color:#dce8ee}
      .coop-list{display:flex;flex-direction:column;gap:6px;max-height:210px;overflow:auto}.coop-list-row{display:grid;grid-template-columns:1fr auto;gap:3px 8px;padding:9px;border:1px solid #c7833566;border-radius:4px;background:#0004}.coop-list-row strong{color:#ffe2a1}.coop-list-row small{color:#aebbc5}.coop-list-row button{grid-row:span 2;padding:5px 12px;border:1px solid #ffd24a;background:#ffd24a;color:#16110a;border-radius:3px;font-weight:900}
      .coop-seats{display:flex;flex-direction:column;gap:5px}.coop-seat{display:grid;grid-template-columns:28px 1fr auto;gap:4px 8px;align-items:center;padding:8px;border:1px solid #51636d;border-radius:4px;background:#0a151acc}.coop-seat.occupied{border-color:#b8873c}.coop-seat.ready{box-shadow:inset 4px 0 #f4bf4f}.coop-seat b{color:#ffd24a}.coop-seat small{grid-column:2/-1;color:#9fb0bd}.coop-ready-mark{color:#9fb0bd;font-size:11px}.coop-seat.ready .coop-ready-mark{color:#ffe2a1}
      .coop-footer{display:flex;flex-direction:column;gap:8px;padding:10px 16px max(14px,env(safe-area-inset-bottom));border-top:1px solid #c7833555;background:#091116e8}.coop-footer .coop-button{width:100%}
      .coop-footer[hidden]{display:none}
      @media(max-height:680px){.coop-body{padding:10px}.coop-card{padding:9px;margin-bottom:8px}.coop-head{padding-top:9px;padding-bottom:8px}.coop-head h2{font-size:17px}}
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'coopBossLobby'; overlay.setAttribute('aria-live', 'polite');
    overlay.innerHTML = `<div class="coop-shell" role="dialog" aria-modal="true" aria-labelledby="coopBossTitle">
      <header class="coop-head"><h2 id="coopBossTitle">CO-OP BOSS</h2><button id="coopClose" type="button">タイトルへ戻る</button></header>
      <main class="coop-body">
        <section id="coopEntry" class="coop-entry">
          <p class="coop-kicker">巨大要塞 共同討伐作戦</p>
          <div class="coop-card"><div class="coop-grid">
            <input id="coopRoomName" class="wide" maxlength="24" autocomplete="off" value="巨大要塞へ挑戦" aria-label="部屋名">
            <select id="coopDifficulty" aria-label="難易度"></select>
            <select id="coopAiFill" aria-label="AI補充"><option value="on">AI補充 ON</option><option value="off">AI補充 OFF</option></select>
            <button id="coopCreate" class="coop-button coop-primary wide" type="button">協力部屋を作る</button>
          </div></div>
          <div class="coop-card"><div class="coop-grid">
            <input id="coopJoinCode" maxlength="8" autocomplete="off" autocapitalize="characters" placeholder="部屋ID 8文字" aria-label="部屋ID">
            <button id="coopJoin" class="coop-button" type="button">IDで参加</button>
            <button id="coopRefresh" class="coop-button wide" type="button">公開協力部屋を更新</button>
          </div><div id="coopRoomList" class="coop-list"></div></div>
        </section>
        <section id="coopRoom" class="coop-room" hidden>
          <p class="coop-kicker">作戦準備室　<span id="coopCode" class="coop-code"></span></p>
          <div id="coopHostSettings" class="coop-card coop-grid"><select id="coopRoomDifficulty" aria-label="難易度"></select><select id="coopRoomAiFill" aria-label="AI補充"><option value="on">AI補充 ON</option><option value="off">AI補充 OFF</option></select></div>
          <div class="coop-card"><div id="coopSeats" class="coop-seats"></div></div>
          <div class="coop-card coop-grid"><select id="coopCharacter" class="wide" aria-label="モンスター"></select><select id="coopSubweapon" aria-label="サブウェポン"></select><select id="coopItem" aria-label="CO-OP ITEM"></select></div>
          <p class="coop-note">装備を変えるとREADYは解除されます。公開版の通常ONLINEとは別の部屋です。</p>
        </section>
        <div id="coopStatus" class="coop-status">協力ロビーを準備しています。</div>
      </main>
      <footer id="coopFooter" class="coop-footer" hidden><button id="coopReady" class="coop-button" type="button">準備完了</button><button id="coopStart" class="coop-button coop-primary" type="button" disabled>全員の準備を待っています</button><button id="coopLeave" class="coop-button" type="button">ロビーを退出</button></footer>
    </div>`;
    document.body.appendChild(overlay);

    const element = (id) => document.getElementById(id);
    const entryEl = element('coopEntry'); const roomEl = element('coopRoom'); const footerEl = element('coopFooter');
    const statusEl = element('coopStatus'); const roomListEl = element('coopRoomList'); const seatsEl = element('coopSeats');
    const difficultyEl = element('coopDifficulty'); const roomDifficultyEl = element('coopRoomDifficulty');
    const aiFillEl = element('coopAiFill'); const roomAiFillEl = element('coopRoomAiFill');
    const characterEl = element('coopCharacter'); const subweaponEl = element('coopSubweapon'); const itemEl = element('coopItem');

    const setStatus = (message) => { statusEl.textContent = message; };
    const setBusy = (value) => { busy = value; overlay.classList.toggle('busy', value); };
    const option = (select, value, label) => { const node = document.createElement('option'); node.value = value; node.textContent = label; select.appendChild(node); };
    foundation.DIFFICULTIES.forEach((value) => {
      if (progress.boss.unlockedDifficulties.includes(value.id)) {
        option(difficultyEl, value.id, value.label); option(roomDifficultyEl, value.id, value.label);
      }
    });
    characters.forEach((value) => option(characterEl, value.id, value.name));
    option(subweaponEl, '', 'サブウェポン: なし');
    foundation.SUBWEAPONS.filter((value) => progress.inventory[value.id]).forEach((value) => option(subweaponEl, value.id, `SUB: ${value.label}`));
    foundation.COOP_ITEMS.filter((value) => progress.inventory[value.id]).forEach((value) => option(itemEl, value.id, `ITEM: ${value.label}`));
    characterEl.value = characterIds[0] || CHARACTER_FALLBACK;
    subweaponEl.value = progress.equipment.subweapon || '';
    itemEl.value = progress.equipment.coopItem || 'rescue-kit';

    function selectedEquipment() {
      return { character: characterEl.value, subweapon: subweaponEl.value || null, coopItem: itemEl.value || 'rescue-kit' };
    }

    function makeSlot(auth, prior = null) {
      const chosen = selectedEquipment();
      return {
        uid: auth.uid,
        name: cleanText(bridge.getPlayerName(), 12, 'ななし'),
        character: chosen.character,
        subweapon: chosen.subweapon,
        coopItem: chosen.coopItem,
        ready: prior?.ready === true,
        claimedAt: prior?.claimedAt || bridge.serverNow(auth),
        seenAt: { '.sv': 'timestamp' },
      };
    }

    function settingsFromEntry() {
      return { difficulty: difficultyEl.value || 'normal', aiFill: aiFillEl.value !== 'off', revision: 1 };
    }

    function stopTimers() {
      clearTimeout(pollTimer); clearTimeout(heartbeatTimer); pollTimer = 0; heartbeatTimer = 0;
    }

    async function publishListing(force = false) {
      if (!session || session.role !== 'host') return;
      const occupied = SEATS.filter((seat) => session.room.slots?.[seat]?.uid).length;
      const now = bridge.serverNow(session.auth);
      if (!force && now - Number(session.lastListingAt || 0) < 20000) return;
      await bridge.request(`coopOpen/${session.code}`, session.auth, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostUid: session.auth.uid, hostName: cleanText(bridge.getPlayerName(), 12, 'ななし'),
          roomName: cleanText(session.roomName, 24, '巨大要塞へ挑戦'), playerCount: occupied,
          difficulty: session.room.settings.difficulty, aiFill: session.room.settings.aiFill,
          createdAt: session.listCreatedAt || now, expiresAt: now + ROOM_TTL_MS,
        }),
      });
      session.lastListingAt = now;
    }

    async function renewHostLease() {
      if (!session || session.role !== 'host') return;
      const now = bridge.serverNow(session.auth);
      if (now - Number(session.lastLeaseAt || 0) < 60000) return;
      const expiresAt = now + ROOM_TTL_MS;
      await bridge.request(`coopRooms/${session.code}/expiresAt`, session.auth, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(expiresAt),
      });
      session.lastLeaseAt = now;
      session.room.expiresAt = expiresAt;
    }

    function renderSeats() {
      seatsEl.textContent = '';
      SEATS.forEach((seat, index) => {
        const raw = session?.room?.slots?.[seat];
        const slot = raw?.uid ? normalizeSlot(raw, { characterIds, inventory: progress.inventory }) : null;
        const row = document.createElement('div'); row.className = `coop-seat${slot ? ' occupied' : ''}${slot?.ready ? ' ready' : ''}`;
        const mark = document.createElement('b'); mark.textContent = `P${index + 1}`;
        const name = document.createElement('span'); name.textContent = slot?.name || (session?.room?.settings?.aiFill ? 'AI補充予定' : '空席');
        const ready = document.createElement('span'); ready.className = 'coop-ready-mark'; ready.textContent = slot ? (slot.ready ? 'READY' : '選択中') : '—';
        const detail = document.createElement('small');
        if (slot) {
          const characterName = characters.find((entry) => entry.id === slot.character)?.name || slot.character;
          const subName = foundation.SUBWEAPONS.find((entry) => entry.id === slot.subweapon)?.label || 'なし';
          const itemName = foundation.COOP_ITEMS.find((entry) => entry.id === slot.coopItem)?.label || '救助弾';
          detail.textContent = `${characterName} ／ SUB ${subName} ／ ITEM ${itemName}`;
        } else detail.textContent = session?.room?.settings?.aiFill ? 'ホスト開始時にAIが担当' : '参加者を待っています';
        row.append(mark, name, ready, detail); seatsEl.appendChild(row);
      });
      const mySlot = session?.room?.slots?.[session.seat];
      element('coopReady').textContent = mySlot?.ready ? '準備を取り消す' : '準備完了';
      const startable = session?.role === 'host' && canHostStart(session.room.slots, session.room.settings);
      const start = element('coopStart'); start.disabled = true;
      start.textContent = startable ? '出撃可能（戦闘接続は次工程）' : '全員の準備を待っています';
    }

    function renderRoom() {
      if (!session) return;
      entryEl.hidden = true; roomEl.hidden = false; footerEl.hidden = false;
      element('coopCode').textContent = session.code;
      roomDifficultyEl.value = session.room.settings?.difficulty || 'normal';
      roomAiFillEl.value = session.room.settings?.aiFill === false ? 'off' : 'on';
      element('coopHostSettings').hidden = session.role !== 'host';
      renderSeats();
    }

    function enterSession(next) {
      session = next; renderRoom(); stopTimers(); schedulePoll(0); scheduleHeartbeat(18000);
      setStatus('参加者と装備を同期しています。');
    }

    async function refreshRoom() {
      if (!session) return;
      const active = session;
      try {
        if (active.role === 'host') await renewHostLease();
        const room = await bridge.request(`coopRooms/${active.code}`, active.auth);
        if (!session || session !== active) return;
        if (!room || room.protocol !== ROOM_PROTOCOL || !room.slots?.[active.seat] || room.slots[active.seat].uid !== active.auth.uid) {
          await leaveRoom(false); setStatus('この協力部屋は終了しました。'); return;
        }
        session.room = room; renderRoom();
        if (session.role === 'host') await publishListing().catch(() => {});
      } catch (_error) { setStatus('同期を再試行しています。通信を確認してください。'); }
    }

    function schedulePoll(delay = 2000) {
      clearTimeout(pollTimer);
      pollTimer = setTimeout(async () => { await refreshRoom(); if (session) schedulePoll(2000); }, delay);
    }

    function scheduleHeartbeat(delay = 18000) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = setTimeout(async () => {
        if (!session) return;
        await bridge.request(`coopRooms/${session.code}/slots/${session.seat}`, session.auth, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seenAt: { '.sv': 'timestamp' } }),
        }).catch(() => {});
        if (session) scheduleHeartbeat(18000);
      }, delay);
    }

    async function createRoom() {
      if (busy || session) return;
      setBusy(true); setStatus('協力部屋を建造しています…');
      try {
        const auth = await bridge.ensureAuth(); const now = bridge.serverNow(auth); const settings = settingsFromEntry();
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const code = bridge.generateRoomCode(); const hostSlot = makeSlot(auth);
          const room = { protocol: ROOM_PROTOCOL, hostUid: auth.uid, createdAt: { '.sv': 'timestamp' }, expiresAt: now + ROOM_TTL_MS, phase: 'lobby', settings, slots: { p1: hostSlot } };
          try {
            await bridge.request(`coopRooms/${code}`, auth, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(room) });
            const next = { role: 'host', seat: 'p1', code, auth, room, roomName: cleanText(element('coopRoomName').value, 24, '巨大要塞へ挑戦'), listCreatedAt: now, lastLeaseAt: now };
            enterSession(next); await publishListing(true); setStatus('部屋を作成しました。仲間を待っています。'); return;
          } catch (_error) { /* コード衝突なら次を試す */ }
        }
        throw new Error('部屋を作れませんでした。');
      } catch (error) { setStatus(error.message || '協力部屋を作れませんでした。'); }
      finally { setBusy(false); }
    }

    async function joinRoom(rawCode) {
      if (busy || session) return;
      const code = normalizeRoomCode(rawCode);
      if (!isRoomCode(code)) { setStatus('部屋IDは8文字で入力してください。'); return; }
      setBusy(true); setStatus('協力部屋へ参加しています…');
      let claimedSeat = null; let auth = null;
      try {
        auth = await bridge.ensureAuth();
        for (const seat of GUEST_SEATS) {
          const claimed = await bridge.claimEmptySlot(`coopRooms/${code}/slots/${seat}`, auth, makeSlot(auth));
          if (claimed) { claimedSeat = seat; break; }
        }
        if (!claimedSeat) throw new Error('この協力部屋は満席です。');
        const room = await bridge.request(`coopRooms/${code}`, auth);
        if (!room || room.protocol !== ROOM_PROTOCOL || room.phase !== 'lobby' || room.slots?.[claimedSeat]?.uid !== auth.uid) throw new Error('参加受付中の部屋ではありません。');
        enterSession({ role: 'guest', seat: claimedSeat, code, auth, room, roomName: '' });
        setStatus('協力部屋へ参加しました。装備を選んで準備完了を押してください。');
      } catch (error) {
        if (claimedSeat && auth) await bridge.request(`coopRooms/${code}/slots/${claimedSeat}`, auth, { method: 'DELETE' }).catch(() => {});
        setStatus(error.message || 'この協力部屋へ参加できませんでした。');
      } finally { setBusy(false); }
    }

    async function refreshListings() {
      if (busy || session) return;
      setBusy(true); setStatus('公開協力部屋を探しています…'); roomListEl.textContent = '';
      try {
        const auth = await bridge.ensureAuth(); const now = bridge.serverNow(auth);
        const listing = await bridge.request('coopOpen', auth, { query: { orderBy: '"createdAt"', limitToFirst: LIST_LIMIT } });
        const rows = Object.entries(listing || {}).filter(([code, value]) => usableListing(code, value, now) && value.hostUid !== auth.uid)
          .sort((a, b) => Number(a[1].createdAt || 0) - Number(b[1].createdAt || 0));
        if (!rows.length) { const empty = document.createElement('small'); empty.textContent = '現在、参加できる協力部屋はありません。'; roomListEl.appendChild(empty); }
        rows.forEach(([code, value]) => {
          const row = document.createElement('div'); row.className = 'coop-list-row';
          const title = document.createElement('strong'); title.textContent = cleanText(value.roomName, 24, '巨大要塞へ挑戦');
          const detail = document.createElement('small'); detail.textContent = `${cleanText(value.hostName, 12, 'ななし')} ／ ${String(value.difficulty).toUpperCase()} ／ ${value.playerCount}/4人 ／ AI ${value.aiFill ? 'ON' : 'OFF'}`;
          const join = document.createElement('button'); join.type = 'button'; join.textContent = '入る'; join.addEventListener('click', () => joinRoom(code));
          row.append(title, detail, join); roomListEl.appendChild(row);
        });
        setStatus(`${rows.length}件の公開協力部屋を表示しています。`);
      } catch (_error) { setStatus('協力部屋一覧を読み込めませんでした。'); }
      finally { setBusy(false); }
    }

    async function updateOwnSlot(nextSlot) {
      if (!session || busy) return;
      setBusy(true);
      try {
        const body = { ...nextSlot, uid: session.auth.uid, name: cleanText(bridge.getPlayerName(), 12, 'ななし'), claimedAt: session.room.slots[session.seat].claimedAt, seenAt: { '.sv': 'timestamp' } };
        await bridge.request(`coopRooms/${session.code}/slots/${session.seat}`, session.auth, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        session.room.slots[session.seat] = { ...body, seenAt: bridge.serverNow(session.auth) }; renderRoom();
      } catch (_error) { setStatus('装備の同期に失敗しました。もう一度お試しください。'); }
      finally { setBusy(false); }
    }

    async function updateHostSettings() {
      if (!session || session.role !== 'host' || busy) return;
      const next = { difficulty: roomDifficultyEl.value || 'normal', aiFill: roomAiFillEl.value !== 'off', revision: Math.max(1, Number(session.room.settings?.revision || 1) + 1) };
      setBusy(true);
      try {
        await bridge.request(`coopRooms/${session.code}/settings`, session.auth, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
        session.room.settings = next; renderRoom(); await publishListing(true);
      } catch (_error) { setStatus('作戦設定を更新できませんでした。'); }
      finally { setBusy(false); }
    }

    async function leaveRoom(showEntry = true) {
      const leaving = session; session = null; stopTimers();
      if (leaving) {
        if (leaving.role === 'host') {
          await bridge.request(`coopOpen/${leaving.code}`, leaving.auth, { method: 'DELETE' }).catch(() => {});
          await bridge.request(`coopRooms/${leaving.code}`, leaving.auth, { method: 'DELETE' }).catch(() => {});
        } else await bridge.request(`coopRooms/${leaving.code}/slots/${leaving.seat}`, leaving.auth, { method: 'DELETE' }).catch(() => {});
      }
      roomEl.hidden = true; footerEl.hidden = true; entryEl.hidden = false;
      if (showEntry) setStatus('協力ロビーから退出しました。');
    }

    function closeOverlay() {
      if (session) { setStatus('先にロビーを退出してください。'); return; }
      overlay.classList.remove('open'); bridge.syncBgm();
    }

    browserOpenHandler = () => {
      const state = bridge.getState();
      if (state.gamePhase !== 'title' || state.onlineActive) return false;
      bridge.playUiSound(); overlay.classList.add('open');
      setStatus('協力部屋を作るか、公開部屋へ参加してください。'); bridge.syncBgm();
      return true;
    };
    element('coopClose').addEventListener('click', closeOverlay);
    element('coopCreate').addEventListener('click', createRoom);
    element('coopJoin').addEventListener('click', () => joinRoom(element('coopJoinCode').value));
    element('coopRefresh').addEventListener('click', refreshListings);
    element('coopLeave').addEventListener('click', () => leaveRoom(true));
    element('coopReady').addEventListener('click', () => {
      if (!session) return; const current = normalizeSlot(session.room.slots[session.seat], { characterIds, inventory: progress.inventory });
      updateOwnSlot({ ...current, ready: !current.ready });
    });
    [characterEl, subweaponEl, itemEl].forEach((select) => select.addEventListener('change', () => {
      if (!session) return; const current = normalizeSlot(session.room.slots[session.seat], { characterIds, inventory: progress.inventory });
      updateOwnSlot(applyEquipmentChange(current, selectedEquipment()));
    }));
    roomDifficultyEl.addEventListener('change', updateHostSettings); roomAiFillEl.addEventListener('change', updateHostSettings);
    element('coopJoinCode').addEventListener('input', (event) => { event.target.value = normalizeRoomCode(event.target.value); });

    return true;
  }

  function openLobby() { return typeof browserOpenHandler === 'function' ? browserOpenHandler() : false; }

  return Object.freeze({
    ROOM_PROTOCOL,
    SEATS,
    GUEST_SEATS,
    normalizeRoomCode,
    isRoomCode,
    normalizeSlot,
    applyEquipmentChange,
    canHostStart,
    sourceNamespaces,
    usableListing,
    initBrowser,
    openLobby,
  });
});
