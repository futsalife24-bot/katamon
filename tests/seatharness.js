// カタモン Stage 2a 検証ハーネス
// index.html の <script> を抜き出し、Canvas/Audio/DOM をスタブしたNode上で実行して
// 「席(localUnit/foeUnit)の切り離しが効いているか」を自動で確かめる。
// 単体では使わない。tests/seattest.js と tests/regressiontest.js から読み込む。
//   node tests/seattest.js p1    (通常の席)
//   node tests/seattest.js e1    (オンライン対戦のゲスト想定の席)
const fs = require('fs');
const path = require('path');
if (!globalThis.crypto) globalThis.crypto = require('crypto').webcrypto;

const SEAT = process.argv[2] === 'e1' ? 'e1' : 'p1';
const HTML = path.join(__dirname, '..', 'index.html');

// ---- スクリプト抽出 ----
const html = fs.readFileSync(HTML, 'utf8');
const m = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/.exec(html);
if (!m) throw new Error('script tag not found');
let code = m[1];

// ---- 検証フックを IIFE の内側に差し込む ----
// (本体には残さない。ここで組み立てるだけ。)
const HOOK = `
  globalThis.__kt = {
    units, unitById, localUnit, foeUnit, activeUnit, isLocalTurn, localWon,
    turnOwnerLabel, setLocalSeat,
    seat: () => localUnitId,
    projectiles: () => projectiles,
    state: () => ({ gamePhase, matchOver, winner, awaitingResolve, turnCount, activeIndex, turnOrder: turnOrder.slice() }),
    panels: () => __panelLog.slice(),
    resetPanels: () => { __panelLog.length = 0; },
    render: () => render(),
    step: (dt) => update(dt),
    startBattle: (key) => { selectCharacterAndStart(key || CHARACTER_LIST[0]); },
    setTerrain: (pattern) => { newTerrain(pattern); },
    chars: () => CHARACTER_LIST.slice(),
    hud: () => ({
      fireActive: isLocalTurn() && !awaitingResolve && !matchOver && !cutIn && localUnit().grounded,
      moveActive: isLocalTurn() && localUnit().moveLockTurns <= 0 && !awaitingResolve && !matchOver && !cutIn,
      turnLabel: turnOwnerLabel(activeUnit()),
      fuelRatio: localUnit().fuelMax > 0 ? localUnit().fuel / localUnit().fuelMax : 0
    }),
    fireBtn: () => ({ ...FIRE_BTN }),
    moveBtns: () => ({ left: { ...leftBtn }, right: { ...rightBtn } }),
    hasCutIn: () => !!cutIn,
    forceWinner: (team) => { winner = team; matchOver = true; },
    // --- リグレッション用 ---
    snapshot: () => buildSnapshot(),
    save: () => saveSuspendedMatch(),
    load: () => loadSuspendedMatch(),
    apply: (d) => applySnapshot(d),
    wind: () => ({ dir: wind.dir, strength: wind.strength }),
    craters: () => craterHistory.length,
    streak: () => winStreak,
    stats: () => ({ ...runStats }),
    mode: () => battleMode,
    freeConfig: () => ({ ...freeModeConfig }),
    startFree: () => { startFreeMatch(); },
    resultTitleBtn: () => ({ ...resultTitleBtn, shift: resultButtonShift() }),
    continueBtn: () => ({ ...continueBtn, shift: resultButtonShift() }),
    keepsRunOnExit: () => keepsRunOnExit(),
    endPause: () => matchEndPause,
    hasSave: () => hasSuspendedSave,
    setStreak: (n) => { winStreak = n; },
    isBoss: () => isBossMatch,
    pattern: () => currentPattern,
    // --- オンライン対戦(ループバック)用 ---
    setTransport: (fn) => { makeTransport = fn; },
    beginOnline: (role) => beginOnline(role),
    endOnline: (sendBye) => endOnline(sendBye),
    exitOnlineFromMenu: () => exitOnlineFromMenu(),
    setOnlineKind: (kind) => { if (online) online.kind = kind; },
    onlineState: () => (online ? {
      role: online.role, phase: online.phase, seat: online.seat,
      queued: online.queue.length, peerLeft: online.peerLeft,
      versionMismatch: online.versionMismatch, resultSent: online.resultSent
    } : null),
    inputLocked: () => netInputLocked(),
    pending: () => !!pendingShot,
    specialBtn: () => ({ ...specialBtn }),
    specialReady: () => isSpecialReady(localUnit()),
    charges: () => units.map(u => u.specialCharge),
    fillCharges: () => { for (const u of units) u.specialCharge = SPECIAL_CHARGE_MAX; },
    proto: () => PROTO_VERSION,
    stage3: () => ({ normalizeRoomCode, isRoomCode, generateRoomCode, parseFirebaseSse, createSseDeduper, commitPayload, fairFirstPlayer, hasSafeSnapshot, normalizeFirebaseSnapshot, validateFirebaseMessage, validateFirebaseMessageDetail, acceptPeerCommit, acceptPeerReveal, firebaseActionMatches, bufferFirebaseTerminal, firebaseFlowAllows, stateSnapshotMatchesBaseline, stateSnapshotMismatchReason, firebasePushId, stableFirebaseJson, normalizeFirebaseMessageForCompare, createSerialSendQueue, advanceFirebasePendingVisibleTime, advanceFirebasePeerLiveness, resetFirebasePeerLiveness, advanceFirebaseLobbyLiveness, firebaseSeatStale, onlineErrorTitle, estimateFirebaseServerNow, firebaseServerTimeOffsetFromToken,
      computeDamage, roomTtlMs: () => ROOM_TTL_MS, roomLeaseRenewMs: () => ROOM_LEASE_RENEW_MS,
      firebaseProto: () => FIREBASE_PROTO_VERSION, firebaseSeats: () => FIREBASE_SEATS.slice(), firebasePlayerSeats: () => FIREBASE_PLAYER_SEATS.slice(), firebaseRoundId, normalizeLobbySettings, firebasePacketSeatAllowed,
      receiveFirebaseForTest: msg => netReceiveInner(msg),
      // 通信ログ(2026-07-27、実機報告の追跡用)。stage3()の内側に置き、既存の h.stage3() 経由で使えるようにする。
      setOnlineForLogTest: (obj) => { online = obj; },
      logOnlineEvent: (e) => logOnlineEvent(e),
      persistOnlineLog: () => persistOnlineLog(),
      onlineLogKey: () => ONLINE_LOG_KEY,
      onlineLogMax: () => ONLINE_LOG_MAX
    }),
    setPhase: (p) => { gamePhase = p; },
    controls: () => units.map(u => u.id + ':' + u.control).join(','),
    unitState: () => units.map(u => ({ id: u.id, hp: u.hp, x: Math.round(u.x * 100) / 100, ch: u.character, g: u.grounded })),
    canvas
  };
  const __panelLog = [];
  { // drawUnitPanel を包んで「左右どちらにどのユニットが出たか」を記録する
    const orig = drawUnitPanel;
    drawUnitPanel = function (u, edgeX, align) { __panelLog.push({ id: u.id, align }); return orig.apply(this, arguments); };
  }
`;
const tail = '\n})();';
const idx = code.lastIndexOf('})();');
if (idx < 0) throw new Error('IIFE tail not found');
code = code.slice(0, idx) + HOOK + '\n' + code.slice(idx);

// ---- ブラウザAPIのスタブ ----
const noop = () => {};
function makeCtx() {
  const ctx = {
    canvas: null,
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    font: '', textAlign: 'start', textBaseline: 'alphabetic',
    shadowColor: '', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    imageSmoothingEnabled: true, filter: 'none', miterLimit: 10, lineDashOffset: 0
  };
  const methods = ['save','restore','beginPath','closePath','moveTo','lineTo','bezierCurveTo','quadraticCurveTo',
    'arc','arcTo','ellipse','rect','roundRect','fill','stroke','clip','fillRect','strokeRect','clearRect',
    'fillText','strokeText','translate','rotate','scale','transform','setTransform','resetTransform',
    'drawImage','putImageData','setLineDash','getLineDash'];
  for (const k of methods) ctx[k] = noop;
  ctx.measureText = () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
  ctx.createLinearGradient = ctx.createRadialGradient = () => ({ addColorStop: noop });
  ctx.createPattern = () => ({});
  ctx.getImageData = (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h });
  ctx.createImageData = (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h });
  ctx.isPointInPath = () => false;
  return ctx;
}
function makeCanvas(w = 540, h = 960) {
  const el = makeElement('canvas');
  el.width = w; el.height = h;
  const ctx = makeCtx();
  ctx.canvas = el;
  el.getContext = () => ctx;
  el.toDataURL = () => 'data:,';
  return el;
}
function makeElement(tag) {
  const listeners = new Map();
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    children: [], value: '', textContent: '', currentTime: 0, volume: 1, loop: false, muted: false,
    width: 0, height: 0, clientWidth: 540, clientHeight: 960,
    addEventListener: (type, fn) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    removeEventListener: noop,
    dispatchEvent: (ev) => { for (const fn of (listeners.get(ev.type) || [])) fn(ev); return true; },
    __fire: (type, ev) => { for (const fn of (listeners.get(type) || [])) fn(Object.assign({ type, preventDefault: noop, stopPropagation: noop }, ev)); },
    setPointerCapture: noop, releasePointerCapture: noop, focus: noop, blur: noop, click: noop,
    appendChild: (c) => c, removeChild: noop, setAttribute: noop, getAttribute: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 540, height: 960, right: 540, bottom: 960, x: 0, y: 0 }),
    play: () => Promise.resolve(), pause: noop, load: noop
  };
  return el;
}

const elements = new Map();
const gameCanvas = makeCanvas();
elements.set('game', gameCanvas);
for (const id of ['debugPanel', 'titleBgm', 'stageBgm', 'roomBgm', 'nameOverlay', 'nameInput', 'nameOk', 'nameCancel']) {
  elements.set(id, makeElement(id.includes('Bgm') ? 'audio' : 'div'));
}

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear()
};

globalThis.document = Object.assign(makeElement('document'), {
  getElementById: id => elements.get(id) || null,
  querySelector: () => null,
  createElement: tag => (tag === 'canvas' ? makeCanvas(8, 8) : makeElement(tag)),
  hidden: false,
  lastModified: new Date().toUTCString(),
  body: makeElement('body'),
  documentElement: makeElement('html'),
  fonts: { ready: Promise.resolve(), load: () => Promise.resolve() }
});

class ImageStub {
  constructor() { this.width = 64; this.height = 64; this.complete = false; }
  set src(v) { this._src = v; setTimeout(() => { this.complete = true; if (this.onerror) this.onerror(); }, 0); }
  get src() { return this._src; }
  addEventListener() {}
}
globalThis.Image = ImageStub;
globalThis.HTMLMediaElement = { HAVE_NOTHING: 0, HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2, HAVE_FUTURE_DATA: 3, HAVE_ENOUGH_DATA: 4 };

const chain = (o) => { o.connect = (dest) => dest || o; o.disconnect = noop; return o; };
class AudioCtxStub {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; this.sampleRate = 44100; }
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  createGain() { return chain({ gain: { value: 1, setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop, cancelScheduledValues: noop } }); }
  createOscillator() { return chain({ type: 'sine', frequency: { value: 440, setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop }, detune: { value: 0, setValueAtTime: noop }, start: noop, stop: noop }); }
  createBuffer() { return { getChannelData: () => new Float32Array(1) }; }
  createBufferSource() { return chain({ buffer: null, start: noop, stop: noop, loop: false, playbackRate: { value: 1, setValueAtTime: noop } }); }
  createBiquadFilter() { return chain({ type: 'lowpass', frequency: { value: 1000, setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop }, Q: { value: 1 }, gain: { value: 0 } }); }
  createDynamicsCompressor() { return chain({ threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 1 }, attack: { value: 0 }, release: { value: 0 } }); }
  createStereoPanner() { return chain({ pan: { value: 0, setValueAtTime: noop } }); }
  createWaveShaper() { return chain({ curve: null, oversample: 'none' }); }
}

// rAF は自動では回さない。テスト側が step() で明示的に時間を進める。
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = noop;
globalThis.fetch = () => Promise.reject(new Error('offline stub'));

// window は pointerup を受け取るので、素通しではなくリスナーを保持する要素スタブにする。
const win = Object.assign(makeElement('window'), {
  innerWidth: 540, innerHeight: 960, devicePixelRatio: 1,
  AudioContext: AudioCtxStub, webkitAudioContext: AudioCtxStub,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop })
});
globalThis.window = win;
globalThis.AudioContext = AudioCtxStub;
globalThis.navigator = { userAgent: 'node-harness', serviceWorker: undefined, vibrate: noop };
globalThis.location = { search: `?seat=${SEAT}`, protocol: 'http:', hostname: 'localhost', href: `http://localhost/?seat=${SEAT}`, reload: noop };
globalThis.history = { back: noop, pushState: noop, replaceState: noop };
globalThis.matchMedia = win.matchMedia;
globalThis.devicePixelRatio = 1;

// ---- 実行 ----
(0, eval)(code);
module.exports = { kt: () => globalThis.__kt, canvas: gameCanvas, SEAT };
