import { describe, expect, it } from 'vitest';

import {
  AuditLogger,
  HttpError,
  OAuthStateManager,
  RateLimiter,
  sanitizeAuditDetails,
  SessionStore,
  verifyCsrf,
} from '../../server/security.js';
import type { AuditEntry, Clock } from '../../server/types.js';

class MutableClock implements Clock {
  constructor(public value: number) {}
  now(): number {
    return this.value;
  }
}

describe('server security primitives', () => {
  it('OAuth stateを署名し、cookie一致・期限・return先を検査する', () => {
    const clock = new MutableClock(1_000);
    const manager = new OAuthStateManager('state-secret-with-more-than-32-characters', 5_000, clock);
    const state = manager.create('/draft/sample-unit');

    expect(manager.verify(state, state).returnTo).toBe('/draft/sample-unit');
    expect(() => manager.verify(`${state}x`, state)).toThrowError(HttpError);
    clock.value = 6_001;
    expect(() => manager.verify(state, state)).toThrowError(/有効期限/);
  });

  it('session tokenを平文キーとして保持せずCSRF不一致を拒否する', () => {
    const clock = new MutableClock(10_000);
    const store = new SessionStore(1_000, clock);
    const created = store.create({ login: 'allowed-user', id: 10 });

    expect(created.key).not.toContain(created.token);
    expect(store.get(created.token)?.session.user.login).toBe('allowed-user');
    expect(() => verifyCsrf(created.session.csrfToken, 'wrong-token')).toThrowError(HttpError);
    clock.value = 11_001;
    expect(store.get(created.token)).toBeNull();
  });

  it('rate limit超過時に再試行秒数を返す', () => {
    const clock = new MutableClock(20_000);
    const limiter = new RateLimiter(2, 10_000, clock);
    limiter.consume('client');
    limiter.consume('client');
    expect(() => limiter.consume('client')).toThrowError(HttpError);
    try {
      limiter.consume('client');
    } catch (error) {
      expect((error as HttpError).status).toBe(429);
      expect((error as HttpError).retryAfterSeconds).toBe(10);
    }
  });

  it('監査ログからtoken・秘密鍵・利用者名を除外する', () => {
    const entries: AuditEntry[] = [];
    const logger = new AuditLogger('audit-secret-with-more-than-32-characters', (entry) => entries.push(entry));
    logger.write('github.prepare', 'success', 'request-1', 'allowed-user', {
      slug: 'sample-unit',
      accessToken: ['ghp', 'abcdefghijklmnopqrstuvwxyz123456'].join('_'),
      note: 'Bearer secret-value',
    });

    expect(entries[0].actorHash).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(entries[0])).not.toContain('allowed-user');
    expect(JSON.stringify(entries[0])).not.toContain('ghp_');
    expect(JSON.stringify(entries[0])).not.toContain('secret-value');
    expect(sanitizeAuditDetails({ privateKey: 'hidden', count: 2 })).toEqual({ count: 2 });
  });
});
