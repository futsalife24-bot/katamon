/**
 * カタモン オンラインランキング API
 *
 * スプレッドシートに紐づくコンテナバインド型スクリプトとして使う。
 * (スプレッドシートを開き「拡張機能 → Apps Script」から作成すること)
 * こうしておくとシートIDをコードに書かずに済み、公開リポジトリへ置いても安全。
 *
 * 順位は「連勝数を主・与ダメ効率を従」とした複合値で決める。
 * 認証は無し。友人内で遊ぶ範囲を想定し、不正対策は最低限に留める。
 */

var SHEET_NAME = 'ranking';
// 列を増やす時は末尾に足すこと。既存行の意味が変わらずに済む。
var HEADERS = ['period', 'deviceId', 'name', 'streak', 'efficiency', 'updatedAt', 'character'];

// 異常値の足切り。これを超える申告は保存せず捨てる。
var MAX_STREAK = 200;
var MAX_EFFICIENCY = 500;
var MAX_NAME_LENGTH = 12;

// 1台あたり1日に受け付ける送信回数。これを超えたぶんは黙って捨てる。
var DAILY_SUBMIT_LIMIT = 60;

var TOP_COUNT = 20;
var MAX_RECORDS_PER_PLAYER = 3;

function doGet(e) {
  var params = (e && e.parameter) || {};
  try {
    switch (params.action) {
      case 'submit':
        return json(submitScore(params));
      case 'top':
      default:
        return json(getTop(params.id || ''));
    }
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// ブラウザからは GET だけで足りるが、POST で来ても同じ処理を通す。
function doPost(e) {
  return doGet(e);
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 今月のランキング期間キー。毎月1日に自動で新しい期間へ切り替わる。 */
function currentPeriod() {
  var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM');
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.setFrozenRows(1);
  }
  // 列を追加した後も動くよう、見出し行が足りていなければ書き直す。
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() < HEADERS.length) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }
  // "2026-07" や数字だけのIDをシートが日付・数値へ勝手に変換すると、
  // 書き込んだ値と読み戻した値が一致しなくなる。該当列は必ず書式をテキストに固定する。
  sheet.getRange('A:B').setNumberFormat('@');
  sheet.getRange('G:G').setNumberFormat('@');
  return sheet;
}

/** 過去に日付として保存されてしまった行も拾えるよう、期間の表記を揃える。 */
function normalizePeriod(value) {
  if (value instanceof Date) {
    var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
    return Utilities.formatDate(value, tz, 'yyyy-MM');
  }
  return String(value);
}

function readRows(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    rows.push({
      rowIndex: i + 2,
      period: normalizePeriod(values[i][0]),
      deviceId: String(values[i][1]),
      name: String(values[i][2]),
      streak: Number(values[i][3]) || 0,
      efficiency: Number(values[i][4]) || 0,
      updatedAt: values[i][5],
      character: String(values[i][6] == null ? '' : values[i][6])
    });
  }
  return rows;
}

/** 連勝数が主、同数なら与ダメ効率で決める。 */
function isBetter(a, b) {
  if (a.streak !== b.streak) return a.streak > b.streak;
  return a.efficiency > b.efficiency;
}

/** ランキング全体の表示順。上位3件の切り出しと順位計算で共通に使う。 */
function compareRankingRows(a, b) {
  if (a.streak !== b.streak) return b.streak - a.streak;
  if (a.efficiency !== b.efficiency) return b.efficiency - a.efficiency;
  return String(a.name).localeCompare(String(b.name));
}

function sameScore(a, b) {
  return a.streak === b.streak && a.efficiency === b.efficiency;
}

function sanitizeName(raw) {
  var name = String(raw == null ? '' : raw).replace(/[\r\n\t]/g, ' ').trim();
  if (!name) name = 'ななし';
  if (name.length > MAX_NAME_LENGTH) name = name.substring(0, MAX_NAME_LENGTH);
  return name;
}

/** 使用キャラのキー。表示名はゲーム側で引くので、ここでは英数字のキーだけを受け付ける。 */
function sanitizeCharacter(raw) {
  var key = String(raw == null ? '' : raw).trim();
  return /^[A-Za-z0-9_]{1,24}$/.test(key) ? key : '';
}

/** 1台あたりの1日の送信回数を数える。上限を超えたら false。 */
function withinDailyLimit(deviceId) {
  var cache = CacheService.getScriptCache();
  var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  var key = 'sub_' + Utilities.formatDate(new Date(), tz, 'yyyyMMdd') + '_' + deviceId;
  var count = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(count), 21600); // 6時間(CacheServiceの上限)
  return count <= DAILY_SUBMIT_LIMIT;
}

function submitScore(params) {
  var deviceId = String(params.id || '').trim();
  if (!deviceId) return { ok: false, error: 'no id' };

  var streak = Math.floor(Number(params.streak));
  var efficiency = Math.floor(Number(params.eff));
  if (!isFinite(streak) || !isFinite(efficiency)) return { ok: false, error: 'bad score' };
  if (streak < 0 || efficiency < 0) return { ok: false, error: 'bad score' };
  // 明らかにあり得ない申告は保存しない
  if (streak > MAX_STREAK || efficiency > MAX_EFFICIENCY) return { ok: false, error: 'out of range' };
  if (!withinDailyLimit(deviceId)) return { ok: false, error: 'rate limited' };

  var entry = {
    period: currentPeriod(),
    deviceId: deviceId,
    name: sanitizeName(params.name),
    streak: streak,
    efficiency: efficiency,
    character: sanitizeCharacter(params.char)
  };

  // 同じ端末の行を読んで書き換えるので、同時実行を直列化する
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet();
    var rows = readRows(sheet);
    var mine = rows.filter(function (row) {
      return row.period === entry.period && row.deviceId === entry.deviceId;
    });
    var updated = false;
    var same = mine.find(function (row) { return sameScore(row, entry); });
    if (same) {
      // 同じスコアの再送は新しい記録を増やさず、名前と使用キャラだけ最新にする。
      sheet.getRange(same.rowIndex, 3, 1, 5)
        .setValues([[entry.name, entry.streak, entry.efficiency, new Date(), entry.character]]);
      updated = true;
    } else if (mine.length < MAX_RECORDS_PER_PLAYER) {
      // 旧形式の1件だけの行も残したまま、同じ端末の2件目・3件目を追加する。
      sheet.appendRow([entry.period, entry.deviceId, entry.name, entry.streak, entry.efficiency, new Date(), entry.character]);
      updated = true;
    } else {
      // 3件を超えたら、その端末の最下位記録を上回る時だけ置き換える。
      var worst = mine.slice().sort(compareRankingRows).pop();
      if (isBetter(entry, worst)) {
        sheet.getRange(worst.rowIndex, 3, 1, 5)
          .setValues([[entry.name, entry.streak, entry.efficiency, new Date(), entry.character]]);
        updated = true;
      }
    }

    // スコアが伸びていなくても、同じ端末の既存行へ名前変更を反映する。
    var currentMine = readRows(sheet).filter(function (row) {
      return row.period === entry.period && row.deviceId === entry.deviceId;
    });
    currentMine.forEach(function (row) {
      if (row.name !== entry.name) sheet.getRange(row.rowIndex, 3).setValue(entry.name);
    });

    // 書き込みを確定させてから読み戻す。挟まないと直前の変更が見えないことがある。
    SpreadsheetApp.flush();
    var result = buildBoard(entry.deviceId);
    result.ok = true;
    result.updated = updated;
    return result;
  } finally {
    lock.releaseLock();
  }
}

function getTop(deviceId) {
  var result = buildBoard(String(deviceId || '').trim());
  result.ok = true;
  return result;
}

function buildBoard(deviceId) {
  var period = currentPeriod();
  var rows = readRows(getSheet()).filter(function (r) { return r.period === period; });
  rows.sort(compareRankingRows);

  var top = [];
  for (var i = 0; i < Math.min(TOP_COUNT, rows.length); i++) {
    top.push({ rank: i + 1, name: rows[i].name, streak: rows[i].streak, efficiency: rows[i].efficiency, character: rows[i].character });
  }

  var me = null;
  if (deviceId) {
    for (var j = 0; j < rows.length; j++) {
      if (rows[j].deviceId === deviceId) {
        me = { rank: j + 1, name: rows[j].name, streak: rows[j].streak, efficiency: rows[j].efficiency, character: rows[j].character };
        break;
      }
    }
  }

  return { period: period, total: rows.length, top: top, me: me };
}
