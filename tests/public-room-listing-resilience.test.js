'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function functionBody(name, nextName) {
  const start = html.indexOf(`  ${name}`);
  const end = html.indexOf(`  ${nextName}`, start + 1);
  assert(start >= 0 && end > start, `${name} source is available`);
  return html.slice(start, end);
}

const readOpenRooms = functionBody('async function readOpenRooms', 'function publicRoomName');
assert.match(readOpenRooms, /firebaseRequest\('open', auth, \{ query: \{ orderBy: '"createdAt"', limitToFirst: OPEN_INDEX_MAX_CANDIDATES \* 2 \} \}\)/);
assert.match(readOpenRooms, /return pickOpenCandidates\(listing, auth\.uid, format, now\)/);
assert.doesNotMatch(readOpenRooms, /catch\s*\(/, 'listing failures must propagate to the presentation boundary');
assert.doesNotMatch(readOpenRooms, /return\s+\[\]/, 'listing failures must not masquerade as an empty listing');

const renderList = functionBody('function renderOpenRoomList', 'function renderOpenRoomListFailure');
assert.match(renderList, /条件に合う公開部屋はありません/);
assert.doesNotMatch(renderList, /一覧だけ読み込めません/);

const renderFailure = functionBody('function renderOpenRoomListFailure', 'async function refreshOpenRoomList');
assert.match(renderFailure, /onlineRoomListError/);
assert.match(renderFailure, /一覧だけ読み込めませんでした/);
assert.match(renderFailure, /部屋を作るか、部屋IDで入室できます/);
assert.match(renderFailure, /更新すると再試行します/);

const refresh = functionBody('async function refreshOpenRoomList', 'async function joinFirebaseRoomFromBrowser');
assert.match(refresh, /catch \(_\) \{ renderOpenRoomListFailure\(\)/);
assert.match(refresh, /finally \{ setOnlineLobbyBusy\(false\); \}/, 'failure must always release lobby controls');
assert.match(refresh, /\$\{rows\.length\}件の公開部屋を表示しています/);

const quickJoin = functionBody('async function joinQuickFirebaseRoom', 'async function renewFirebaseRoomLease');
assert.match(quickJoin, /try \{ candidates = await readOpenRooms\(auth, wanted, now\); \}/);
assert.match(quickJoin, /catch \(_\) \{ candidates = \[\]; \}/, 'listing-only failure must preserve quick room creation');
assert.match(quickJoin, /const made = await createFirebaseRoom\(/, 'quick room creation remains available');

assert.match(html, /id="onlineCreateMode"/);
assert.match(html, /id="onlineCodeToggle"/);
assert.match(html, /id="onlineJoin"/);
assert.match(html, /onlineCreateModeButton\.addEventListener\('click'/);
assert.match(html, /onlineCodeToggleButton\.addEventListener\('click'/);
assert.match(html, /onlineJoinButton\.addEventListener\('click'/);

console.log('public room listing resilience targeted tests passed');
