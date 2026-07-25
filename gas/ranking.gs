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
var HEADERS = ['period', 'deviceId', 'name', 'streak', 'efficiency', 'updatedAt'];

// 異常値の足切り。これを超える申告は保存せず捨てる。
var MAX_STREAK = 200;
var MAX_EFFICIENCY = 500;
var MAX_NAME_LENGTH = 12;

// 1台あたり1日に受け付ける送信回数。これを超えたぶんは黙って捨てる。
var DAILY_SUBMIT_LIMIT = 60;

var TOP_COUNT = 20;

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
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readRows(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    rows.push({
      rowIndex: i + 2,
      period: String(values[i][0]),
      deviceId: String(values[i][1]),
      name: String(values[i][2]),
      streak: Number(values[i][3]) || 0,
      efficiency: Number(values[i][4]) || 0,
      updatedAt: values[i][5]
    });
  }
  return rows;
}

/** 連勝数が主、同数なら与ダメ効率で決める。 */
function isBetter(a, b) {
  if (a.streak !== b.streak) return a.streak > b.streak;
  return a.efficiency > b.efficiency;
}

function sanitizeName(raw) {
  var name = String(raw == null ? '' : raw).replace(/[\r\n\t]/g, ' ').trim();
  if (!name) name = 'ななし';
  if (name.length > MAX_NAME_LENGTH) name = name.substring(0, MAX_NAME_LENGTH);
  return name;
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
    efficiency: efficiency
  };

  // 同じ端末の行を読んで書き換えるので、同時実行を直列化する
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet();
    var rows = readRows(sheet);
    var mine = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].period === entry.period && rows[i].deviceId === entry.deviceId) {
        mine = rows[i];
        break;
      }
    }

    var updated = false;
    if (!mine) {
      sheet.appendRow([entry.period, entry.deviceId, entry.name, entry.streak, entry.efficiency, new Date()]);
      updated = true;
    } else if (isBetter(entry, mine)) {
      // 自己ベストを更新した時だけ上書きする
      sheet.getRange(mine.rowIndex, 3, 1, 4)
        .setValues([[entry.name, entry.streak, entry.efficiency, new Date()]]);
      updated = true;
    } else if (mine.name !== entry.name) {
      // スコアが伸びていなくても、名前の変更だけは反映する
      sheet.getRange(mine.rowIndex, 3).setValue(entry.name);
    }

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
  rows.sort(function (a, b) {
    if (a.streak !== b.streak) return b.streak - a.streak;
    if (a.efficiency !== b.efficiency) return b.efficiency - a.efficiency;
    return String(a.name).localeCompare(String(b.name));
  });

  var top = [];
  for (var i = 0; i < Math.min(TOP_COUNT, rows.length); i++) {
    top.push({ rank: i + 1, name: rows[i].name, streak: rows[i].streak, efficiency: rows[i].efficiency });
  }

  var me = null;
  if (deviceId) {
    for (var j = 0; j < rows.length; j++) {
      if (rows[j].deviceId === deviceId) {
        me = { rank: j + 1, name: rows[j].name, streak: rows[j].streak, efficiency: rows[j].efficiency };
        break;
      }
    }
  }

  return { period: period, total: rows.length, top: top, me: me };
}
