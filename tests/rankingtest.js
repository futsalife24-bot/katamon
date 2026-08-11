const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class FakeRange {
  constructor(sheet, row, col, rows, cols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.rows = rows;
    this.cols = cols;
  }
  getValues() {
    return Array.from({ length: this.rows }, (_, r) =>
      Array.from({ length: this.cols }, (_, c) => this.sheet.cells[this.row - 1 + r]?.[this.col - 1 + c] ?? '')
    );
  }
  setValues(values) {
    values.forEach((row, r) => row.forEach((value, c) => {
      while (!this.sheet.cells[this.row - 1 + r]) this.sheet.cells.push([]);
      this.sheet.cells[this.row - 1 + r][this.col - 1 + c] = value;
    }));
    return this;
  }
  setValue(value) { return this.setValues([[value]]); }
  setNumberFormat() { return this; }
}

class FakeSheet {
  constructor(rows = []) { this.cells = rows.map(row => row.slice()); }
  getLastRow() { return this.cells.length; }
  getLastColumn() { return this.cells.reduce((n, row) => Math.max(n, row.length), 0); }
  getRange(row, col, rows, cols) {
    if (typeof row === 'string') return new FakeRange(this, 1, 1, 1, 1);
    return new FakeRange(this, row, col, rows, cols);
  }
  appendRow(row) { this.cells.push(row.slice()); }
  setFrozenRows() {}
}

function loadRanking(initialRows = []) {
  const sheet = new FakeSheet(initialRows);
  const cache = new Map();
  const context = {
    console,
    Date,
    isFinite,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: () => sheet, insertSheet: () => sheet }),
      flush: () => {}
    },
    Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
    Utilities: { formatDate: (_date, _tz, format) => format === 'yyyy-MM' ? '2026-08' : '20260811' },
    CacheService: { getScriptCache: () => ({ get: key => cache.get(key), put: (key, value) => cache.set(key, value) }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    ContentService: { createTextOutput: value => ({ value, setMimeType: () => ({ value }) }), MimeType: { JSON: 'json' } }
  };
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '..', 'gas', 'ranking.gs'), 'utf8'), context);
  return { context, sheet };
}

function submit(api, id, streak, efficiency, character, name = 'メロニキ') {
  return api.context.submitScore({ id, streak: String(streak), eff: String(efficiency), char: character, name });
}

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log(`PASS ${label}`);
}

const api = loadRanking([['period', 'deviceId', 'name', 'streak', 'efficiency', 'updatedAt', 'character']]);

check('同じプレイヤーの月間記録を上位3件まで保持する', () => {
  submit(api, 'player-a', 10, 100, 'kyoryu');
  submit(api, 'player-a', 8, 90, 'iwa');
  submit(api, 'player-a', 6, 80, 'tori');
  const board = api.context.getTop('player-a');
  assert.equal(board.total, 3);
  assert.deepEqual(Array.from(board.top, row => row.character), ['kyoryu', 'iwa', 'tori']);
});

check('4件目は自己ベスト3件に入る時だけ最下位を置き換える', () => {
  const rejected = submit(api, 'player-a', 5, 70, 'neko');
  assert.equal(rejected.total, 3);
  assert.deepEqual(Array.from(api.context.getTop('player-a').top, row => row.character), ['kyoryu', 'iwa', 'tori']);
  submit(api, 'player-a', 9, 70, 'neko');
  assert.deepEqual(Array.from(api.context.getTop('player-a').top, row => row.character), ['kyoryu', 'neko', 'iwa']);
});

check('同じスコアの再送は行を増やさずキャラだけ更新できる', () => {
  submit(api, 'player-a', 9, 70, 'medama');
  const board = api.context.getTop('player-a');
  assert.equal(board.total, 3);
  assert.equal(board.top.find(row => row.streak === 9 && row.efficiency === 70).character, 'medama');
});

check('旧形式のcharacter空欄行を読み、次の記録を追加できる', () => {
  const legacy = loadRanking([
    ['period', 'deviceId', 'name', 'streak', 'efficiency', 'updatedAt'],
    ['2026-08', 'legacy', '旧プレイヤー', 7, 60, new Date()]
  ]);
  submit(legacy, 'legacy', 6, 50, 'sumoeru');
  const board = legacy.context.getTop('legacy');
  assert.equal(board.total, 2);
  assert.equal(board.top.find(row => row.streak === 7).character, '');
  assert.equal(board.top.find(row => row.streak === 6).character, 'sumoeru');
});

console.log(`RESULT ${passed}/4 passed`);
