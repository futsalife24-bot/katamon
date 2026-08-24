'use strict';

// 端末の「戻る」処理だけを index.html から抜き出し、
// Android相当のCloseWatcher経路と未対応ブラウザの履歴フォールバックを分けて検査する。
// 画面遷移が始まってから確認を出す退行を、見た目ではなく履歴APIの呼び出し順で止める。
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const startMarker = '  // ===== 端末の「戻る」操作 =====';
const endMarker = '  // ===== ゲームループ =====';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error('device back block not found');
const deviceBackCode = html.slice(start, end);

class EventHost {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  fire(type, event = {}) {
    if (!event.type) event.type = type;
    if (!event.target) event.target = this;
    for (const fn of this.listeners.get(type) || []) fn(event);
    return event;
  }
}

class TestElement extends EventHost {
  constructor(id) {
    super();
    this.id = id;
    this.hidden = true;
    this.attributes = new Map();
    this.focusCount = 0;
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name)
    };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  focus() { this.focusCount++; }
}

class HTMLElementStub extends TestElement {}

let pass = 0;
let fail = 0;
function check(label, fn) {
  try {
    fn();
    pass++;
    console.log(`PASS: ${label}`);
  } catch (error) {
    fail++;
    console.error(`FAIL: ${label}`);
    console.error(`  ${error.message}`);
  }
}

// 抜き出した処理が参照するゲーム状態だけをFunction内へ置く。
function env(options) {
  const declaration = [
    '  let gamePhase = initialPhase;',
    '  let confirmDialog = null;',
    '  let soundPanelOpen = false;',
    '  let menuOpen = false;',
    '  let soundTestOpen = false;',
    '  let updateHistoryOpen = false;',
    '  let titleMenuPage = initialTitlePage;',
    '  let titleMenuGesture = initialTitleGesture ? { page: titleMenuPage } : null;',
    '  let inputMode = null;',
    '  let inputPointerId = null;',
    '  let titleMenuCancelCount = 0;',
    '  const TITLE_MENU_BATTLE = 0;',
    '  const TITLE_MENU_GARAGE = 1;',
    '  function closeSoundTest() { soundTestOpen = false; }',
    '  function cancelTitleMenuGesture() { titleMenuCancelCount++; titleMenuGesture = null; inputMode = null; inputPointerId = null; return true; }',
    '  function titleMenuVisualPosition() { return titleMenuPage; }',
    '  function startTitleMenuTransition(page) { titleMenuPage = page; return true; }',
    ''
  ].join('\n');
  return makeEnvironmentWithCode(options, declaration + deviceBackCode);
}

function makeEnvironmentWithCode(options, code) {
  const closeWatcher = options?.closeWatcher !== false;
  const phase = options?.phase || 'press';
  const initialTitlePage = options?.titleMenuPage ?? 0;
  const initialTitleGesture = !!options?.titleMenuGesture;
  const roomOpen = !!options?.roomOpen;
  const windowStub = new EventHost();
  const timers = [];
  const elements = new Map([
    ['deviceBackConfirm', new HTMLElementStub('deviceBackConfirm')],
    ['deviceBackStay', new HTMLElementStub('deviceBackStay')],
    ['deviceBackExit', new HTMLElementStub('deviceBackExit')]
  ]);
  const historyLog = [];
  const currentUrl = options?.currentUrl || 'https://example.test/katamon/index.html';
  const navigationUrls = options?.navigationUrls || [currentUrl];
  const navigationEntries = navigationUrls.map((url, index) => ({ url, index }));
  const navigationStub = {
    entries: () => navigationEntries.slice(),
    currentEntry: navigationEntries[navigationEntries.length - 1] || null
  };
  const locationStub = { href: currentUrl };

  class CloseWatcherStub extends EventHost {
    constructor() {
      super();
      this.active = true;
      this.destroyCount = 0;
      CloseWatcherStub.instances.push(this);
    }
    destroy() {
      if (!this.active) return;
      this.active = false;
      this.destroyCount++;
    }
    requestBack(cancelable = true) {
      const event = {
        type: 'cancel', cancelable, defaultPrevented: false,
        preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
      };
      this.fire('cancel', event);
      if (!event.defaultPrevented && this.active) {
        this.active = false;
        this.fire('close');
      }
      return event;
    }
  }
  CloseWatcherStub.instances = [];
  const activeWatcherCount = () => CloseWatcherStub.instances.filter(watcher => watcher.active).length;
  const historyStub = {
    state: options?.historyState || null,
    length: options?.historyLength ?? navigationEntries.length,
    pushState(state) { this.state = state; historyLog.push({ type: 'pushState', activeWatchers: activeWatcherCount() }); },
    replaceState(state) { this.state = state; historyLog.push({ type: 'replaceState', activeWatchers: activeWatcherCount() }); },
    back() { historyLog.push({ type: 'back', activeWatchers: activeWatcherCount() }); },
    go(delta) { historyLog.push({ type: 'go', delta, activeWatchers: activeWatcherCount() }); }
  };
  if (closeWatcher) windowStub.CloseWatcher = CloseWatcherStub;
  windowStub.navigation = navigationStub;
  windowStub.navigator = { standalone: !!options?.navigatorStandalone };
  windowStub.close = () => historyLog.push({ type: 'close', activeWatchers: activeWatcherCount() });
  windowStub.matchMedia = query => ({
    matches: query === '(display-mode: standalone)' && !!options?.standalone
  });
  const documentStub = {
    hidden: false,
    activeElement: null,
    getElementById: id => elements.get(id) || null,
    contains: element => [...elements.values()].includes(element)
  };
  const buildApi = new Function(
    'window', 'document', 'history', 'navigation', 'location', 'HTMLElement', 'requestAnimationFrame', 'setTimeout',
    'playUiSound', 'saveAudioSettings', 'roomScreenOpen', 'canOpenMenu', 'initialPhase', 'initialTitlePage', 'initialTitleGesture',
    `${code}\nreturn {
      syncBackTrap,
      confirmDeviceExit,
      deviceBackConfirmOpen,
      state: () => ({ backTrapDepth, ignoringBackPop, exitBackSteps, menuOpen, soundPanelOpen, confirmDialog, titleMenuPage, titleMenuGesture, titleMenuCancelCount })
    };`
  );
  const api = buildApi(
    windowStub, documentStub, historyStub, navigationStub, locationStub, HTMLElementStub,
    callback => callback(),
    callback => { timers.push(callback); return timers.length; },
    () => {}, () => {}, () => roomOpen, () => true, phase, initialTitlePage, initialTitleGesture
  );
  return {
    api, window: windowStub, history: historyStub, historyLog, elements, CloseWatcher: CloseWatcherStub,
    runTimers() { while (timers.length) timers.shift()(); }
  };
}

check('CloseWatcher対応環境では履歴ガードを積まず、Watcherを1つだけ作る', () => {
  const h = env();
  h.api.syncBackTrap();
  h.api.syncBackTrap();
  assert.equal(h.CloseWatcher.instances.length, 1);
  assert.equal(h.historyLog.filter(item => item.type === 'pushState').length, 0);
});

check('対応環境の戻る要求はcancelで止め、履歴を動かす前に独自確認を開く', () => {
  const h = env();
  h.api.syncBackTrap();
  const event = h.CloseWatcher.instances[0].requestBack(true);
  assert.equal(event.defaultPrevented, true);
  assert.equal(h.elements.get('deviceBackConfirm').classList.contains('open'), true);
  assert.equal(h.historyLog.filter(item => item.type === 'back').length, 0);
});

check('このまま遊ぶでは画面とWatcherを維持する', () => {
  const h = env();
  h.api.syncBackTrap();
  h.CloseWatcher.instances[0].requestBack(true);
  h.elements.get('deviceBackStay').fire('click');
  assert.equal(h.elements.get('deviceBackConfirm').classList.contains('open'), false);
  assert.equal(h.CloseWatcher.instances[0].active, true);
  assert.equal(h.historyLog.filter(item => item.type === 'back').length, 0);
});

check('アプリを閉じるではWatcherを先に破棄し、履歴移動を1回だけ呼ぶ', () => {
  const h = env({
    navigationUrls: [
      'https://example.test/katamon/tools/stage-studio/',
      'https://example.test/katamon/index.html'
    ],
    historyLength: 2
  });
  h.api.syncBackTrap();
  const watcher = h.CloseWatcher.instances[0];
  watcher.requestBack(true);
  h.elements.get('deviceBackExit').fire('click');
  const moves = h.historyLog.filter(item => item.type === 'go');
  assert.equal(watcher.active, false);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].delta, -1);
  assert.equal(moves[0].activeWatchers, 0);
});

check('古い同一URLガードが3枚あっても、終了1回でまとめてカタモンの外へ戻る', () => {
  const h = env({
    currentUrl: 'https://example.test/katamon/?v=v165&refresh=4',
    navigationUrls: [
      'https://example.test/katamon/tools/stage-studio/',
      'https://example.test/katamon/',
      'https://example.test/katamon/?v=v140&refresh=1',
      'https://example.test/katamon/index.html?v=v150&refresh=2',
      'https://example.test/katamon/?v=v165&refresh=4'
    ],
    historyLength: 5
  });
  h.api.syncBackTrap();
  h.CloseWatcher.instances[0].requestBack(true);
  h.elements.get('deviceBackExit').fire('click');
  assert.deepEqual(
    h.historyLog.filter(item => item.type === 'go').map(item => item.delta),
    [-4]
  );
  assert.equal(h.historyLog.filter(item => item.type === 'back').length, 0);
});

check('戻り先が無いホーム画面PWAは、履歴移動ではなくウィンドウを閉じる', () => {
  const h = env({ standalone: true, historyLength: 1 });
  h.api.syncBackTrap();
  h.CloseWatcher.instances[0].requestBack(true);
  h.elements.get('deviceBackExit').fire('click');
  assert.equal(h.historyLog.filter(item => item.type === 'close').length, 1);
  assert.equal(h.historyLog.filter(item => item.type === 'back' || item.type === 'go').length, 0);
});

check('古いガードが残るホーム画面PWAも、終了1回でウィンドウを閉じに行く', () => {
  const h = env({
    standalone: true,
    currentUrl: 'https://example.test/katamon/?refresh=3',
    navigationUrls: [
      'https://example.test/katamon/',
      'https://example.test/katamon/?refresh=1',
      'https://example.test/katamon/index.html?refresh=2',
      'https://example.test/katamon/?refresh=3'
    ],
    historyLength: 4
  });
  h.api.syncBackTrap();
  h.CloseWatcher.instances[0].requestBack(true);
  h.elements.get('deviceBackExit').fire('click');
  assert.equal(h.historyLog.filter(item => item.type === 'close').length, 1);
  assert.deepEqual(h.historyLog.filter(item => item.type === 'go').map(item => item.delta), [-4]);
});

check('対応環境でpopstateが届いても履歴を積み直して往復させない', () => {
  const h = env();
  h.api.syncBackTrap();
  h.window.fire('popstate');
  assert.equal(h.historyLog.filter(item => item.type === 'pushState').length, 0);
  assert.equal(h.elements.get('deviceBackConfirm').classList.contains('open'), false);
});

check('CloseWatcher未対応環境だけは従来の履歴ガードで確認を出す', () => {
  const h = env({ closeWatcher: false });
  h.api.syncBackTrap();
  assert.equal(h.historyLog.filter(item => item.type === 'pushState').length, 1);
  h.history.state = null;
  h.window.fire('popstate');
  assert.equal(h.historyLog.filter(item => item.type === 'pushState').length, 2);
  assert.equal(h.elements.get('deviceBackConfirm').classList.contains('open'), true);
});

check('未対応環境の再読み込みで既存ガードを重ねない', () => {
  const h = env({ closeWatcher: false, historyState: { katamonGuard: true } });
  h.api.syncBackTrap();
  assert.equal(h.historyLog.filter(item => item.type === 'pushState').length, 0);
  assert.equal(h.api.state().backTrapDepth, 1);
});

check('未対応環境の明示終了はガードと元履歴の2段だけを通る', () => {
  const h = env({ closeWatcher: false, historyLength: 3 });
  h.api.syncBackTrap();
  h.history.state = null;
  h.window.fire('popstate');
  h.elements.get('deviceBackExit').fire('click');
  assert.deepEqual(h.historyLog.filter(item => item.type === 'go').map(item => item.delta), [-2]);
  assert.equal(h.historyLog.filter(item => item.type === 'back').length, 0);
});

check('バトル中の戻る要求は終了確認ではなく既存メニューを開く', () => {
  const h = env({ phase: 'battle' });
  h.api.syncBackTrap();
  h.CloseWatcher.instances[0].requestBack(true);
  assert.equal(h.api.state().menuOpen, true);
  assert.equal(h.elements.get('deviceBackConfirm').classList.contains('open'), false);
});

check('タイトルのGARAGEでは1回目の戻るでBATTLEへ戻り、2回目で終了確認を開く', () => {
  const h = env({ phase: 'title', titleMenuPage: 1 });
  h.api.syncBackTrap();
  const watcher = h.CloseWatcher.instances[0];
  watcher.requestBack(true);
  assert.equal(h.api.state().titleMenuPage, 0);
  assert.equal(h.elements.get('deviceBackConfirm').classList.contains('open'), false);
  watcher.requestBack(true);
  assert.equal(h.elements.get('deviceBackConfirm').classList.contains('open'), true);
});

check('タイトル押下中の戻る要求は背面のCanvas入力を破棄して終了確認を開く', () => {
  const h = env({ phase: 'title', titleMenuPage: 0, titleMenuGesture: true });
  h.api.syncBackTrap();
  h.CloseWatcher.instances[0].requestBack(true);
  assert.equal(h.api.state().titleMenuCancelCount, 1);
  assert.equal(h.api.state().titleMenuGesture, null);
  assert.equal(h.elements.get('deviceBackConfirm').classList.contains('open'), true);
});

check('cancelを止められない場合も履歴へ流さず、確認を保ってWatcherを張り直す', () => {
  const h = env();
  h.api.syncBackTrap();
  h.CloseWatcher.instances[0].requestBack(false);
  h.runTimers();
  assert.equal(h.elements.get('deviceBackConfirm').classList.contains('open'), true);
  assert.equal(h.historyLog.filter(item => item.type === 'back').length, 0);
  assert.equal(h.CloseWatcher.instances.length, 2);
  assert.equal(h.CloseWatcher.instances[1].active, true);
});

check('ページ破棄時はcleanupし、復帰するまでWatcherを作り直さない', () => {
  const h = env();
  h.api.syncBackTrap();
  const watcher = h.CloseWatcher.instances[0];
  h.window.fire('pagehide');
  h.api.syncBackTrap();
  assert.equal(watcher.active, false);
  assert.equal(h.CloseWatcher.instances.length, 1);
  h.window.fire('pageshow');
  assert.equal(h.CloseWatcher.instances.length, 2);
  assert.equal(h.CloseWatcher.instances[1].active, true);
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exitCode = fail ? 1 : 0;
