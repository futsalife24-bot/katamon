export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

export interface AuthenticatedUser {
  login: string;
  id: number;
}

export interface SessionRecord {
  user: AuthenticatedUser;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
}

export interface ServerConfig {
  host: string;
  port: number;
  publicAppUrl: URL;
  allowedOrigins: ReadonlySet<string>;
  githubApiUrl: string;
  githubWebUrl: string;
  githubOAuthClientId: string;
  githubOAuthClientSecret: string;
  githubAppId: string;
  githubPrivateKey: string;
  githubInstallationId: string;
  githubOwner: string;
  githubRepo: string;
  githubBaseBranch: string;
  allowedGithubUsers: ReadonlySet<string>;
  sessionSecret: string;
  sessionTtlMs: number;
  oauthStateTtlMs: number;
  preparationTtlMs: number;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  maxRequestBytes: number;
  maxFileBytes: number;
  maxTotalFileBytes: number;
  maxFiles: number;
  maxImageDimension: number;
  maxImagePixels: number;
  allowedPathPrefixes: readonly string[];
  allowedExactFiles: ReadonlySet<string>;
  trustProxy: boolean;
  configured: boolean;
  configurationErrors: readonly string[];
}

export interface SubmittedFile {
  path: string;
  mimeType: string;
  byteLength: number;
  sha256: string;
  contentBase64: string;
}

export interface SubmittedBundle {
  bundleId: string;
  generatorVersion: string;
  expectedBaseSha?: string;
  character: {
    id: string;
    slug: string;
    displayName: string;
  };
  files: SubmittedFile[];
  prBody: string;
}

export interface ValidatedFile {
  path: string;
  mimeType: string;
  bytes: Buffer;
  sha256: string;
  gitBlobSha: string;
}

export interface ValidatedBundle {
  bundleId: string;
  generatorVersion: string;
  expectedBaseSha?: string;
  character: {
    id: string;
    slug: string;
    displayName: string;
  };
  files: ValidatedFile[];
  prBody: string;
  digest: string;
}

export interface GitTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

export type BuildState = 'idle' | 'queued' | 'running' | 'success' | 'failure';
export type DeploymentState = 'unknown' | 'pending' | 'published' | 'failure';

export interface PreparedRecord {
  id: string;
  actorKey: string;
  bundleDigest: string;
  slug: string;
  baseSha: string;
  branch: string;
  expiresAt: number;
  result?: {
    number: number;
    url: string;
    branch: string;
    commitSha: string;
    checks: BuildState;
    deployment: DeploymentState;
  };
  pendingCommitSha?: string;
}

export interface AuditEntry {
  at: string;
  event: string;
  outcome: 'success' | 'denied' | 'failure';
  requestId: string;
  actorHash?: string;
  details?: Record<string, string | number | boolean | null>;
}
