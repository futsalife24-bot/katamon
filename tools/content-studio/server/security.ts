import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import type {
  AuditEntry,
  AuthenticatedUser,
  Clock,
  SessionRecord,
} from './types.js';
import { systemClock } from './types.js';

export const SESSION_COOKIE = '__Host-content_studio_session';
export const OAUTH_STATE_COOKIE = '__Host-content_studio_oauth_state';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function equalText(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name || cookies.has(name)) continue;
    cookies.set(name, value);
  }
  return cookies;
}

export function secureCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
): string {
  return `${name}=${value}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSecureCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export class SessionStore {
  private readonly records = new Map<string, SessionRecord>();

  constructor(
    private readonly ttlMs: number,
    private readonly clock: Clock = systemClock,
  ) {}

  create(user: AuthenticatedUser): { token: string; key: string; session: SessionRecord } {
    this.cleanup();
    const token = randomBytes(32).toString('base64url');
    const key = sha256(token);
    const now = this.clock.now();
    const session: SessionRecord = {
      user,
      csrfToken: randomBytes(32).toString('base64url'),
      createdAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.records.set(key, session);
    return { token, key, session };
  }

  get(token: string | undefined): { key: string; session: SessionRecord } | null {
    if (!token) return null;
    const key = sha256(token);
    const session = this.records.get(key);
    if (!session) return null;
    if (session.expiresAt <= this.clock.now()) {
      this.records.delete(key);
      return null;
    }
    return { key, session };
  }

  destroy(token: string | undefined): void {
    if (token) this.records.delete(sha256(token));
  }

  cleanup(): void {
    const now = this.clock.now();
    for (const [key, session] of this.records) {
      if (session.expiresAt <= now) this.records.delete(key);
    }
  }
}

interface OAuthStatePayload {
  nonce: string;
  expiresAt: number;
  returnTo: string;
}

export function safeReturnTo(value: string | null | undefined): string {
  if (!value) return '/';
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    /[\x00-\x1f\x7f]/.test(value)
  ) {
    return '/';
  }
  return value.slice(0, 1_024);
}

export class OAuthStateManager {
  constructor(
    private readonly secret: string,
    private readonly ttlMs: number,
    private readonly clock: Clock = systemClock,
  ) {}

  create(returnTo: string): string {
    const payload: OAuthStatePayload = {
      nonce: randomBytes(24).toString('base64url'),
      expiresAt: this.clock.now() + this.ttlMs,
      returnTo: safeReturnTo(returnTo),
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.secret).update(encoded).digest('base64url');
    return `${encoded}.${signature}`;
  }

  verify(queryState: string | null, cookieState: string | undefined): OAuthStatePayload {
    if (!queryState || !cookieState || !equalText(queryState, cookieState)) {
      throw new HttpError(400, 'oauth_state_mismatch', 'ログイン状態を確認できませんでした。もう一度お試しください。');
    }
    const [encoded, signature, extra] = queryState.split('.');
    if (!encoded || !signature || extra !== undefined) {
      throw new HttpError(400, 'oauth_state_invalid', 'ログイン状態が不正です。');
    }
    const expected = createHmac('sha256', this.secret).update(encoded).digest('base64url');
    if (!equalText(signature, expected)) {
      throw new HttpError(400, 'oauth_state_invalid', 'ログイン状態が不正です。');
    }
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch {
      throw new HttpError(400, 'oauth_state_invalid', 'ログイン状態が不正です。');
    }
    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof (payload as OAuthStatePayload).nonce !== 'string' ||
      typeof (payload as OAuthStatePayload).expiresAt !== 'number' ||
      typeof (payload as OAuthStatePayload).returnTo !== 'string'
    ) {
      throw new HttpError(400, 'oauth_state_invalid', 'ログイン状態が不正です。');
    }
    const validPayload = payload as OAuthStatePayload;
    if (validPayload.expiresAt <= this.clock.now()) {
      throw new HttpError(400, 'oauth_state_expired', 'ログイン操作の有効期限が切れました。もう一度お試しください。');
    }
    return { ...validPayload, returnTo: safeReturnTo(validPayload.returnTo) };
  }
}

interface RateBucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, RateBucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: Clock = systemClock,
  ) {}

  consume(key: string): void {
    const now = this.clock.now();
    const current = this.buckets.get(key);
    if (!current || current.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      this.cleanup(now);
      return;
    }
    current.count += 1;
    if (current.count > this.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1_000));
      throw new HttpError(
        429,
        'rate_limited',
        '操作が多すぎます。少し待ってから再試行してください。',
        retryAfterSeconds,
      );
    }
  }

  private cleanup(now: number): void {
    if (this.buckets.size < 1_000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

const SECRET_KEY = /token|secret|private|authorization|cookie|code|state|password|key/i;
const SECRET_VALUE = /(gh[pousr]_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|bearer\s+[A-Za-z0-9._~-]+)/gi;

export function sanitizeAuditDetails(
  input: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | null> | undefined {
  if (!input) return undefined;
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (SECRET_KEY.test(key)) continue;
    if (typeof value === 'string') {
      clean[key] = value.slice(0, 160).replace(SECRET_VALUE, '[redacted]');
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      clean[key] = value;
    } else if (typeof value === 'boolean' || value === null) {
      clean[key] = value;
    }
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

export class AuditLogger {
  constructor(
    private readonly secret: string,
    private readonly sink: (entry: AuditEntry) => void = (entry) => {
      console.info(JSON.stringify(entry));
    },
  ) {}

  actorHash(login: string | undefined): string | undefined {
    if (!login) return undefined;
    return createHmac('sha256', this.secret).update(login.toLowerCase()).digest('hex').slice(0, 16);
  }

  write(
    event: string,
    outcome: AuditEntry['outcome'],
    requestId: string,
    login?: string,
    details?: Record<string, unknown>,
  ): void {
    this.sink({
      at: new Date().toISOString(),
      event: event.slice(0, 80),
      outcome,
      requestId: requestId.slice(0, 80),
      actorHash: this.actorHash(login),
      details: sanitizeAuditDetails(details),
    });
  }
}

export function verifyCsrf(expected: string, supplied: string | undefined): void {
  if (!supplied || !equalText(expected, supplied)) {
    throw new HttpError(403, 'csrf_invalid', '操作の確認情報が一致しません。画面を再読み込みしてください。');
  }
}

export function verifyOrigin(origin: string | undefined, allowedOrigins: ReadonlySet<string>): void {
  if (!origin || !allowedOrigins.has(origin)) {
    throw new HttpError(403, 'origin_denied', 'この画面からの操作は許可されていません。');
  }
}
