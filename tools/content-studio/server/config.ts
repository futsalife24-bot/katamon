import { PUBLISH_LIMITS } from '../src/domain/publish-limits.js';
import { randomBytes } from 'node:crypto';

import type { ServerConfig } from './types.js';

const DEFAULT_PATH_PREFIXES = [
  'content/characters/',
  'generated/',
  'assets/content-studio/',
] as const;

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.trim().toLowerCase() === 'true';
}

function validateRepositoryPart(value: string, label: string, errors: string[]): void {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) {
    errors.push(`${label} is invalid`);
  }
}

function validateBranch(value: string, errors: string[]): void {
  if (
    value.length === 0 ||
    value.length > 120 ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('..') ||
    value.includes('//') ||
    /[\x00-\x20~^:?*[\\]/.test(value)
  ) {
    errors.push('GITHUB_BASE_BRANCH is invalid');
  }
}

function normalizePrivateKey(value: string | undefined): string {
  return (value ?? '').replace(/\\n/g, '\n').trim();
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const configurationErrors: string[] = [];
  const testMode = env.NODE_ENV === 'test';
  const publicAppUrl = new URL(env.PUBLIC_APP_URL || 'http://localhost:4174');
  const githubOwner = (env.GITHUB_OWNER ?? '').trim();
  const githubRepo = (env.GITHUB_REPO ?? '').trim();
  const githubBaseBranch = (env.GITHUB_BASE_BRANCH || 'master').trim();
  const githubOAuthClientId = (env.GITHUB_OAUTH_CLIENT_ID ?? '').trim();
  const githubOAuthClientSecret = (env.GITHUB_OAUTH_CLIENT_SECRET ?? '').trim();
  const githubAppId = (env.GITHUB_APP_ID ?? '').trim();
  const githubPrivateKey = normalizePrivateKey(env.GITHUB_PRIVATE_KEY);
  const githubInstallationId = (env.GITHUB_INSTALLATION_ID ?? '').trim();
  const allowedGithubUsers = new Set(csv(env.ALLOWED_GITHUB_USERS).map((item) => item.toLowerCase()));
  const suppliedSessionSecret = (env.SESSION_SECRET ?? '').trim();
  const sessionSecret = suppliedSessionSecret || randomBytes(32).toString('base64url');

  const required: Array<[string, string]> = [
    ['GITHUB_OWNER', githubOwner],
    ['GITHUB_REPO', githubRepo],
    ['GITHUB_OAUTH_CLIENT_ID', githubOAuthClientId],
    ['GITHUB_OAUTH_CLIENT_SECRET', githubOAuthClientSecret],
    ['GITHUB_APP_ID', githubAppId],
    ['GITHUB_PRIVATE_KEY', githubPrivateKey],
    ['GITHUB_INSTALLATION_ID', githubInstallationId],
  ];
  for (const [name, value] of required) {
    if (!value) configurationErrors.push(`${name} is required`);
  }
  if (allowedGithubUsers.size === 0) configurationErrors.push('ALLOWED_GITHUB_USERS is required');
  if (suppliedSessionSecret.length < 32) configurationErrors.push('SESSION_SECRET must contain at least 32 characters');
  if (githubOwner) validateRepositoryPart(githubOwner, 'GITHUB_OWNER', configurationErrors);
  if (githubRepo) validateRepositoryPart(githubRepo, 'GITHUB_REPO', configurationErrors);
  validateBranch(githubBaseBranch, configurationErrors);
  if (githubAppId && !/^\d+$/.test(githubAppId)) configurationErrors.push('GITHUB_APP_ID must be numeric');
  if (githubInstallationId && !/^\d+$/.test(githubInstallationId)) {
    configurationErrors.push('GITHUB_INSTALLATION_ID must be numeric');
  }

  const additionalOrigins = csv(env.ADDITIONAL_ALLOWED_ORIGINS).map((origin) => new URL(origin).origin);
  const allowedOrigins = new Set([publicAppUrl.origin, ...additionalOrigins]);
  const allowedExactFiles = new Set(csv(env.GITHUB_ALLOWED_EXACT_FILES));
  const host = (env.HOST || '127.0.0.1').trim();
  if (!/^(?:127\.0\.0\.1|0\.0\.0\.0|localhost)$/.test(host)) {
    configurationErrors.push('HOST must be 127.0.0.1, localhost, or 0.0.0.0');
  }

  return {
    host,
    port: positiveInteger(env.PORT, 8787),
    publicAppUrl,
    allowedOrigins,
    // URL overrides exist only for isolated tests. Production traffic is pinned to GitHub.
    githubApiUrl: (testMode && env.GITHUB_API_URL ? env.GITHUB_API_URL : 'https://api.github.com').replace(/\/$/, ''),
    githubWebUrl: (testMode && env.GITHUB_WEB_URL ? env.GITHUB_WEB_URL : 'https://github.com').replace(/\/$/, ''),
    githubOAuthClientId,
    githubOAuthClientSecret,
    githubAppId,
    githubPrivateKey,
    githubInstallationId,
    githubOwner,
    githubRepo,
    githubBaseBranch,
    allowedGithubUsers,
    sessionSecret,
    sessionTtlMs: positiveInteger(env.SESSION_TTL_SECONDS, 8 * 60 * 60) * 1_000,
    oauthStateTtlMs: positiveInteger(env.OAUTH_STATE_TTL_SECONDS, 10 * 60) * 1_000,
    preparationTtlMs: positiveInteger(env.PREPARATION_TTL_SECONDS, 30 * 60) * 1_000,
    rateLimitWindowMs: positiveInteger(env.RATE_LIMIT_WINDOW_SECONDS, 60) * 1_000,
    rateLimitMax: positiveInteger(env.RATE_LIMIT_MAX, 60),
    maxRequestBytes: Math.min(positiveInteger(env.MAX_REQUEST_BYTES, PUBLISH_LIMITS.maxRequestBytes), PUBLISH_LIMITS.maxRequestBytes),
    maxFileBytes: Math.min(positiveInteger(env.MAX_FILE_BYTES, PUBLISH_LIMITS.maxFileBytes), PUBLISH_LIMITS.maxFileBytes),
    maxTotalFileBytes: Math.min(positiveInteger(env.MAX_TOTAL_FILE_BYTES, PUBLISH_LIMITS.maxTotalFileBytes), PUBLISH_LIMITS.maxTotalFileBytes),
    maxFiles: Math.min(positiveInteger(env.MAX_FILES, PUBLISH_LIMITS.maxFiles), PUBLISH_LIMITS.maxFiles),
    maxImageDimension: positiveInteger(env.MAX_IMAGE_DIMENSION, 8192),
    maxImagePixels: positiveInteger(env.MAX_IMAGE_PIXELS, 16_777_216),
    allowedPathPrefixes: DEFAULT_PATH_PREFIXES,
    allowedExactFiles,
    trustProxy: booleanValue(env.TRUST_PROXY, false),
    configured: configurationErrors.length === 0,
    configurationErrors,
  };
}
