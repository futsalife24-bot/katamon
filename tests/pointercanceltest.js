// A browser/OS interruption must not commit an aimed shot.
const assert = require('node:assert/strict');
const h = require('./seatharness.js');
const kt = h.kt();
kt.startBattle();
let frames = 0;
while ((kt.hasCutIn() || !kt.isLocalTurn()) && frames++ < 5000) kt.step(1 / 60);
assert.ok(kt.hud().fireActive, 'local player can aim');
const fb = kt.fireBtn();
const event = (id, x, y) => ({ pointerId: id, clientX: x, clientY: y, pointerType: 'touch', timeStamp: Date.now(), button: 0 });
function aim(id) {
  h.canvas.__fire('pointerdown', event(id, fb.x, fb.y));
  h.canvas.__fire('pointermove', event(id, fb.x - 60, fb.y + 60));
}
aim(1);
window.__fire('pointercancel', event(1, fb.x - 60, fb.y + 60));
assert.equal(kt.projectiles().length, 0, 'interrupted aim does not fire');
assert.equal(kt.state().awaitingResolve, false, 'interruption does not spend the turn');
window.__fire('pointerup', event(1, fb.x - 60, fb.y + 60));
assert.equal(kt.projectiles().length, 0, 'late release cannot fire a cancelled aim');
aim(2);
window.__fire('pointercancel', event(99, fb.x - 60, fb.y + 60));
window.__fire('pointerup', event(2, fb.x - 60, fb.y + 60));
assert.ok(kt.projectiles().length > 0, 'fresh aim releases normally; unrelated finger cancellation is ignored');
assert.equal(kt.state().awaitingResolve, true, 'normal release still commits the shot');
console.log('Pointer cancellation: 6 assertions passed');
