import { parseBoundedJson } from '../src/domain/bounded-json.js';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { GitHubClient } from './github-api.js';
import { RepositoryService } from './repository-service.js';
import {
  AuditLogger,
  clearSecureCookie,
  HttpError,
  OAUTH_STATE_COOKIE,
  OAuthStateManager,
  parseCookies,
  RateLimiter,
  safeReturnTo,
  secureCookie,
  SESSION_COOKIE,
  SessionStore,
  verifyCsrf,
  verifyOrigin,
} from './security.js';
import type { ServerConfig } from './types.js';
import { validateSubmission } from './validation.js';

export interface ApiDependencies {
  config: ServerConfig;
  github?: GitHubClient;
  repository?: RepositoryService;
  sessions?: SessionStore;
  oauthStates?: OAuthStateManager;
  limiter?: RateLimiter;
  audit?: AuditLogger;
}

interface RequestContext {
  id: string;
  url: URL;
  ip: string;
}

function securityHeaders(response: ServerResponse): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body), 'utf8');
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', data.length);
  response.end(data);
}

function sendRedirect(response: ServerResponse, location: string): void {
  response.statusCode = 302;
  response.setHeader('Location', location);
  response.setHeader('Content-Length', '0');
  response.end();
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new HttpError(415, 'content_type_invalid', 'JSON形式で送信してください。');
  }
  const contentLength = Number(request.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new HttpError(413, 'request_too_large', '送信データが上限を超えています。');
  }
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += bytes.length;
    if (received > maxBytes) {
      throw new HttpError(413, 'request_too_large', '送信データが上限を超えています。');
    }
    chunks.push(bytes);
  }
  if (received === 0) throw new HttpError(400, 'request_empty', '送信データがありません。');
  try {
    return parseBoundedJson(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'json_invalid', 'JSONを読み込めませんでした。');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requestIp(request: IncomingMessage, config: ServerConfig): string {
  if (config.trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
    if (first && /^[0-9a-f:.]{2,64}$/i.test(first.trim())) return first.trim();
  }
  return request.socket.remoteAddress || 'unknown';
}

function requireConfigured(config: ServerConfig): void {
  if (!config.configured) {
    throw new HttpError(503, 'github_not_configured', '実GitHub連携はまだ設定されていません。モックモードを利用してください。');
  }
}

export function createApiHandler(dependencies: ApiDependencies) {
  const { config } = dependencies;
  const github = dependencies.github ?? new GitHubClient(config);
  const repository = dependencies.repository ?? new RepositoryService(config, github);
  const sessions = dependencies.sessions ?? new SessionStore(config.sessionTtlMs);
  const oauthStates = dependencies.oauthStates ?? new OAuthStateManager(config.sessionSecret, config.oauthStateTtlMs);
  const limiter = dependencies.limiter ?? new RateLimiter(config.rateLimitMax, config.rateLimitWindowMs);
  const audit = dependencies.audit ?? new AuditLogger(config.sessionSecret);

  return async function apiHandler(request: IncomingMessage, response: ServerResponse): Promise<void> {
    securityHeaders(response);
    const context: RequestContext = {
      id: randomUUID(),
      url: new URL(request.url || '/', config.publicAppUrl),
      ip: requestIp(request, config),
    };
    response.setHeader('X-Request-Id', context.id);
    let auditEvent = 'api.request';
    let auditLogin: string | undefined;
    try {
      limiter.consume(context.ip);
      const method = request.method || 'GET';
      const pathname = context.url.pathname;
      const cookies = parseCookies(request.headers.cookie);
      const sessionLookup = sessions.get(cookies.get(SESSION_COOKIE));
      auditLogin = sessionLookup?.session.user.login;

      if (method === 'GET' && pathname === '/api/health') {
        sendJson(response, 200, {
          ok: true,
          configured: config.configured,
          version: '0.1.0',
          missing: config.configured
            ? []
            : config.configurationErrors.map((message) => message.split(' ', 1)[0]),
        });
        return;
      }

      if (method === 'GET' && pathname === '/api/auth/session') {
        sendJson(response, 200, sessionLookup
          ? {
              authenticated: true,
              configured: config.configured,
              user: sessionLookup.session.user.login,
              csrfToken: sessionLookup.session.csrfToken,
              expiresAt: new Date(sessionLookup.session.expiresAt).toISOString(),
            }
          : { authenticated: false, configured: config.configured, user: null });
        return;
      }

      if (method === 'GET' && pathname === '/api/auth/login') {
        auditEvent = 'auth.login_started';
        requireConfigured(config);
        const state = oauthStates.create(safeReturnTo(context.url.searchParams.get('returnTo')));
        response.setHeader(
          'Set-Cookie',
          secureCookie(OAUTH_STATE_COOKIE, state, Math.ceil(config.oauthStateTtlMs / 1_000)),
        );
        audit.write(auditEvent, 'success', context.id);
        sendRedirect(response, github.oauthAuthorizeUrl(state));
        return;
      }

      if (method === 'GET' && pathname === '/api/auth/callback') {
        auditEvent = 'auth.callback';
        requireConfigured(config);
        const state = oauthStates.verify(
          context.url.searchParams.get('state'),
          cookies.get(OAUTH_STATE_COOKIE),
        );
        response.setHeader('Set-Cookie', clearSecureCookie(OAUTH_STATE_COOKIE));
        if (context.url.searchParams.has('error')) {
          throw new HttpError(401, 'oauth_cancelled', 'GitHubログインは完了しませんでした。');
        }
        const code = context.url.searchParams.get('code');
        if (!code) throw new HttpError(400, 'oauth_code_missing', 'GitHubから認証情報を受け取れませんでした。');
        const user = await github.authenticateOAuthCode(code);
        auditLogin = user.login;
        if (!config.allowedGithubUsers.has(user.login.toLowerCase())) {
          audit.write(auditEvent, 'denied', context.id, user.login);
          throw new HttpError(403, 'user_not_allowed', 'このGitHubユーザーには管理権限がありません。');
        }
        const created = sessions.create(user);
        response.setHeader(
          'Set-Cookie',
          secureCookie(SESSION_COOKIE, created.token, Math.ceil(config.sessionTtlMs / 1_000)),
        );
        audit.write(auditEvent, 'success', context.id, user.login);
        sendRedirect(response, new URL(state.returnTo, config.publicAppUrl).toString());
        return;
      }

      if (method === 'POST' && pathname === '/api/auth/logout') {
        auditEvent = 'auth.logout';
        if (!sessionLookup) throw new HttpError(401, 'session_required', 'ログインが必要です。');
        verifyOrigin(request.headers.origin, config.allowedOrigins);
        verifyCsrf(sessionLookup.session.csrfToken, request.headers['x-csrf-token'] as string | undefined);
        sessions.destroy(cookies.get(SESSION_COOKIE));
        response.setHeader('Set-Cookie', clearSecureCookie(SESSION_COOKIE));
        audit.write(auditEvent, 'success', context.id, sessionLookup.session.user.login);
        sendJson(response, 200, { ok: true });
        return;
      }

      if (pathname.startsWith('/api/github/')) {
        requireConfigured(config);
        if (!sessionLookup) throw new HttpError(401, 'session_required', 'GitHubへ接続してください。');
      }

      if (method === 'GET' && pathname === '/api/github/status') {
        const status = await repository.getStatus();
        sendJson(response, 200, {
          mode: 'server',
          connected: true,
          user: sessionLookup!.session.user.login,
          build: status.build,
          deployment: status.deployment,
          baseSha: status.baseSha,
          publishLimits: { maxFileBytes: config.maxFileBytes, maxTotalFileBytes: config.maxTotalFileBytes, maxRequestBytes: config.maxRequestBytes, maxFiles: config.maxFiles },
          message: 'GitHubへ安全に接続しています。',
        });
        return;
      }

      if (method === 'POST' && pathname === '/api/github/prepare') {
        auditEvent = 'github.prepare';
        verifyOrigin(request.headers.origin, config.allowedOrigins);
        verifyCsrf(sessionLookup!.session.csrfToken, request.headers['x-csrf-token'] as string | undefined);
        const body = await readJsonBody(request, config.maxRequestBytes);
        const bundle = validateSubmission(body, config);
        const result = await repository.prepare(bundle, String(sessionLookup!.session.user.id));
        audit.write(auditEvent, 'success', context.id, sessionLookup!.session.user.login, {
          slug: bundle.character.slug,
          files: result.changedFiles.length,
          bytes: result.changedFiles.reduce((sum, file) => sum + file.byteLength, 0),
        });
        sendJson(response, 200, result);
        return;
      }

      if (method === 'POST' && pathname === '/api/github/pull-requests') {
        auditEvent = 'github.pull_request';
        verifyOrigin(request.headers.origin, config.allowedOrigins);
        verifyCsrf(sessionLookup!.session.csrfToken, request.headers['x-csrf-token'] as string | undefined);
        const body = await readJsonBody(request, config.maxRequestBytes);
        if (!isRecord(body) || typeof body.preparationId !== 'string') {
          throw new HttpError(422, 'preparation_invalid', '公開準備IDがありません。');
        }
        const bundle = validateSubmission(body.bundle, config);
        const result = await repository.createPullRequest(body.preparationId, bundle, String(sessionLookup!.session.user.id));
        audit.write(auditEvent, 'success', context.id, sessionLookup!.session.user.login, {
          slug: bundle.character.slug,
          pullRequest: result.number,
          files: bundle.files.length,
        });
        sendJson(response, 201, result);
        return;
      }

      if (method === 'POST' && pathname === '/api/github/merge') {
        auditEvent = 'github.merge';
        verifyOrigin(request.headers.origin, config.allowedOrigins);
        verifyCsrf(sessionLookup!.session.csrfToken, request.headers['x-csrf-token'] as string | undefined);
        const body = await readJsonBody(request, config.maxRequestBytes);
        if (
          !isRecord(body)
          || typeof body.preparationId !== 'string'
          || !Number.isSafeInteger(body.pullRequestNumber)
          || typeof body.expectedHeadSha !== 'string'
        ) {
          throw new HttpError(422, 'merge_request_invalid', 'マージ要求が不正です。');
        }
        const result = await repository.mergePullRequest(
          body.preparationId,
          body.pullRequestNumber as number,
          body.expectedHeadSha,
          String(sessionLookup!.session.user.id),
        );
        audit.write(auditEvent, 'success', context.id, sessionLookup!.session.user.login, {
          pullRequest: result.number,
          merged: result.merged === true,
        });
        sendJson(response, 200, result);
        return;
      }

      if (method === 'GET' && pathname === '/api/github/checks') {
        const ref = context.url.searchParams.get('ref');
        if (!ref || !/^[a-f0-9]{40}$/.test(ref)) {
          throw new HttpError(422, 'ref_invalid', '確認対象のコミットSHAが不正です。');
        }
        sendJson(response, 200, { build: await github.getChecks(ref) });
        return;
      }

      if (method === 'GET' && pathname === '/api/github/deployment') {
        const ref = context.url.searchParams.get('ref');
        if (!ref || !/^[a-f0-9]{40}$/.test(ref)) {
          throw new HttpError(422, 'ref_invalid', '確認対象のコミットSHAが不正です。');
        }
        sendJson(response, 200, { deployment: await github.getDeployment(ref) });
        return;
      }

      throw new HttpError(404, 'not_found', 'APIが見つかりません。');
    } catch (error) {
      const handled = error instanceof HttpError
        ? error
        : new HttpError(500, 'internal_error', 'サーバー処理に失敗しました。時間をおいて再試行してください。');
      if (handled.retryAfterSeconds) response.setHeader('Retry-After', handled.retryAfterSeconds);
      audit.write(
        auditEvent,
        handled.status === 401 || handled.status === 403 ? 'denied' : 'failure',
        context.id,
        auditLogin,
        { code: handled.code, status: handled.status, path: context.url.pathname },
      );
      if (!response.writableEnded) {
        sendJson(response, handled.status, {
          error: { code: handled.code, message: handled.message, requestId: context.id },
        });
      }
    }
  };
}
