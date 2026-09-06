import { PUBLISH_LIMITS } from '../src/domain/publish-limits.js';
import { randomBytes, createPrivateKey } from 'node:crypto';
import { isIP } from 'node:net';

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
  const production = env.NODE_ENV === 'production';
  let publicAppUrl = new URL('http://localhost:4174');
  try { publicAppUrl = new URL(env.PUBLIC_APP_URL || publicAppUrl.href); }
  catch { configurationErrors.push('PUBLIC_APP_URL must be a valid origin'); }
  if (production && (!env.PUBLIC_APP_URL || !/^https:\/\/[^/\\?#\s]+\/?$/.test(env.PUBLIC_APP_URL) || publicAppUrl.protocol !== 'https:' || publicAppUrl.username || publicAppUrl.password || publicAppUrl.search || publicAppUrl.hash || publicAppUrl.pathname !== '/')) {
    configurationErrors.push('PUBLIC_APP_URL must be an explicit HTTPS origin without credentials, path, query or fragment');
  }
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
  const sessionSecret = suppliedSessionSecret || (production ? '' : randomBytes(32).toString('base64url'));

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
  if ([...allowedGithubUsers].some(user => !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(user))) configurationErrors.push('ALLOWED_GITHUB_USERS must contain valid GitHub logins');
  if (production) {
    for(const name of ['GITHUB_APP_ID','GITHUB_INSTALLATION_ID'])if(!/^[1-9][0-9]{0,14}$/.test(env[name]??''))configurationErrors.push(`${name} must be a positive integer`);
    for(const name of ['TRUST_PROXY'])if(env[name]!==undefined&&!['true','false'].includes(env[name]!))configurationErrors.push(`${name} must be true or false`);
    const bounds:Record<string,number>={PORT:65535,SESSION_TTL_SECONDS:86400,OAUTH_STATE_TTL_SECONDS:600,PREPARATION_TTL_SECONDS:3600,RATE_LIMIT_WINDOW_SECONDS:3600,RATE_LIMIT_MAX:1000,MAX_IMAGE_DIMENSION:8192,MAX_IMAGE_PIXELS:16777216,MAX_REQUEST_BYTES:PUBLISH_LIMITS.maxRequestBytes,MAX_FILE_BYTES:PUBLISH_LIMITS.maxFileBytes,MAX_TOTAL_FILE_BYTES:PUBLISH_LIMITS.maxTotalFileBytes,MAX_FILES:PUBLISH_LIMITS.maxFiles};
    for(const [name,max] of Object.entries(bounds))if(env[name]!==undefined&&(!/^[1-9][0-9]*$/.test(env[name]!)||!Number.isSafeInteger(Number(env[name]))||Number(env[name])>max))configurationErrors.push(`${name} must be a positive integer within its documented limit`);
    if(env.GITHUB_ALLOWED_EXACT_FILES)configurationErrors.push('GITHUB_ALLOWED_EXACT_FILES is not allowed in production');
    if (!env.GITHUB_BASE_BRANCH) configurationErrors.push('GITHUB_BASE_BRANCH is required');
    try {
      const key = createPrivateKey(githubPrivateKey);
      if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error();
    } catch { configurationErrors.push('GITHUB_PRIVATE_KEY must be a valid RSA private key of at least 2048 bits'); }
  }
  if (suppliedSessionSecret.length < 32) configurationErrors.push('SESSION_SECRET must contain at least 32 characters');
  if (githubOwner) validateRepositoryPart(githubOwner, 'GITHUB_OWNER', configurationErrors);
  if (githubRepo) validateRepositoryPart(githubRepo, 'GITHUB_REPO', configurationErrors);
  validateBranch(githubBaseBranch, configurationErrors);
  if (githubAppId && !/^\d+$/.test(githubAppId)) configurationErrors.push('GITHUB_APP_ID must be numeric');
  if (githubInstallationId && !/^\d+$/.test(githubInstallationId)) {
    configurationErrors.push('GITHUB_INSTALLATION_ID must be numeric');
  }

  const additionalOrigins: string[] = [];
  for (const origin of csv(env.ADDITIONAL_ALLOWED_ORIGINS)) {
    try { additionalOrigins.push(new URL(origin).origin); }
    catch { configurationErrors.push('ADDITIONAL_ALLOWED_ORIGINS is invalid'); }
  }
  if (production && additionalOrigins.length) configurationErrors.push('ADDITIONAL_ALLOWED_ORIGINS is not allowed in production');
  const trustedProxyAddresses = csv(env.TRUSTED_PROXY_ADDRESSES);
  if (trustedProxyAddresses.some(address => !isIP(address))) configurationErrors.push('TRUSTED_PROXY_ADDRESSES must contain exact IP addresses');
  if (production && booleanValue(env.TRUST_PROXY, false) && !trustedProxyAddresses.length) configurationErrors.push('TRUSTED_PROXY_ADDRESSES is required when TRUST_PROXY is true');
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
    trustedProxyAddresses,
    production,
    configured: configurationErrors.length === 0,
    configurationErrors,
  };
}
