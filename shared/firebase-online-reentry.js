(function attachKatamonFirebaseOnlineReentry(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonFirebaseOnlineReentry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonFirebaseOnlineReentry() {
  'use strict';

  const FIREBASE_REENTRY_VERSION = 1;
  const FIREBASE_REENTRY_STORAGE_KEY = 'katamon_firebase_reentry_v1';
  const ROOM_CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;
  const SEATS = Object.freeze(['p1', 'e1', 's1', 's2']);
  const ROUND_STATUSES = Object.freeze(['lobby', 'revealing', 'playing', 'results']);
  const ROUND_ID_RE = /^[0-9a-f]{48}$/;

  class FirebaseReentryError extends Error {
    constructor(code, message) {
      super(message || code);
      this.name = 'FirebaseReentryError';
      this.code = code;
    }
  }
  function fail(code, message) { throw new FirebaseReentryError(code, message); }
  function exact(value, keys, code = 'INVALID_FIREBASE_REENTRY_CREDENTIAL') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
    const actual = Object.keys(value).sort();
    const expected = keys.slice().sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
  }
  function nonEmptyString(value, code = 'INVALID_FIREBASE_REENTRY_CREDENTIAL') {
    if (typeof value !== 'string' || value.length < 1 || value.length > 4096 || /[\u0000-\u001f]/.test(value)) fail(code);
    return value;
  }
  function safeTimestamp(value, code = 'INVALID_FIREBASE_REENTRY_CREDENTIAL') {
    if (!Number.isSafeInteger(value) || value < 1700000000000 || value > 4102444800000) fail(code);
    return value;
  }
  function validateCredential(value) {
    exact(value, ['hostUid', 'lastConfirmedExpiresAt', 'refreshToken', 'roomCode', 'roomCreatedAt', 'savedAt', 'seat', 'uid', 'version']);
    if (value.version !== FIREBASE_REENTRY_VERSION) fail('UNSUPPORTED_FIREBASE_REENTRY_CREDENTIAL');
    const roomCode = nonEmptyString(value.roomCode);
    if (!ROOM_CODE_RE.test(roomCode)) fail('INVALID_FIREBASE_REENTRY_CREDENTIAL');
    const seat = nonEmptyString(value.seat);
    if (!SEATS.includes(seat)) fail('INVALID_FIREBASE_REENTRY_CREDENTIAL');
    const credential = {
      version: FIREBASE_REENTRY_VERSION,
      uid: nonEmptyString(value.uid),
      refreshToken: nonEmptyString(value.refreshToken),
      roomCode,
      seat,
      roomCreatedAt: safeTimestamp(value.roomCreatedAt),
      hostUid: nonEmptyString(value.hostUid),
      lastConfirmedExpiresAt: safeTimestamp(value.lastConfirmedExpiresAt),
      savedAt: safeTimestamp(value.savedAt)
    };
    return Object.freeze(credential);
  }
  function parseCredential(raw) {
    if (typeof raw !== 'string' || raw.length < 1) fail('INVALID_FIREBASE_REENTRY_CREDENTIAL');
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { fail('INVALID_FIREBASE_REENTRY_CREDENTIAL'); }
    return validateCredential(parsed);
  }
  function serializeCredential(value) { return JSON.stringify(validateCredential(value)); }
  function createCredential({ uid, refreshToken, roomCode, seat, roomCreatedAt, hostUid, lastConfirmedExpiresAt, savedAt }) {
    return validateCredential({
      version: FIREBASE_REENTRY_VERSION,
      uid, refreshToken, roomCode, seat, roomCreatedAt, hostUid, lastConfirmedExpiresAt, savedAt
    });
  }
  function rotateCredential(value, { refreshToken, lastConfirmedExpiresAt, savedAt }) {
    const current = validateCredential(value);
    return createCredential({ ...current, refreshToken, lastConfirmedExpiresAt, savedAt });
  }
  function isDefinitelyExpired(value, now) {
    const credential = validateCredential(value);
    if (!Number.isFinite(now)) fail('INVALID_FIREBASE_REENTRY_NOW');
    return credential.lastConfirmedExpiresAt <= now;
  }
  function validateRoomIdentity(room, credentialValue, { protocol, serverNow }) {
    const credential = validateCredential(credentialValue);
    if (!room || typeof room !== 'object' || Array.isArray(room)) fail('FIREBASE_REENTRY_ROOM_INVALID');
    if (room.protocol !== protocol) fail('FIREBASE_REENTRY_ROOM_PROTOCOL_MISMATCH');
    if (room.createdAt !== credential.roomCreatedAt) fail('FIREBASE_REENTRY_ROOM_IDENTITY_MISMATCH');
    if (room.hostUid !== credential.hostUid) fail('FIREBASE_REENTRY_ROOM_IDENTITY_MISMATCH');
    if (!Number.isFinite(serverNow) || !Number.isFinite(room.expiresAt) || room.expiresAt <= serverNow) fail('FIREBASE_REENTRY_ROOM_EXPIRED');
    const slot = room.slots && room.slots[credential.seat];
    if (!slot || typeof slot !== 'object' || slot.uid !== credential.uid) fail('FIREBASE_REENTRY_SEAT_MISMATCH');
    if (!room.round || typeof room.round !== 'object' || !ROUND_ID_RE.test(room.round.id) || !ROUND_STATUSES.includes(room.round.status)) {
      fail('FIREBASE_REENTRY_ROUND_INVALID');
    }
    return Object.freeze({
      roomCode: credential.roomCode,
      seat: credential.seat,
      role: credential.seat === 'p1' ? 'host' : 'guest',
      roundId: room.round.id,
      roundStatus: room.round.status,
      expiresAt: room.expiresAt
    });
  }
  function isDefinitiveRefreshError(status, firebaseErrorCode) {
    if (status !== 400 && status !== 401 && status !== 403) return false;
    return ['INVALID_REFRESH_TOKEN', 'TOKEN_EXPIRED', 'USER_DISABLED', 'USER_NOT_FOUND', 'INVALID_GRANT_TYPE'].includes(String(firebaseErrorCode || '').toUpperCase());
  }

  return Object.freeze({
    FIREBASE_REENTRY_VERSION,
    FIREBASE_REENTRY_STORAGE_KEY,
    FirebaseReentryError,
    validateCredential,
    parseCredential,
    serializeCredential,
    createCredential,
    rotateCredential,
    isDefinitelyExpired,
    validateRoomIdentity,
    isDefinitiveRefreshError
  });
});
