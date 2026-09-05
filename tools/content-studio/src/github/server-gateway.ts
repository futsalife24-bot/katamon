import { assertPublishSize, assertRequestSize, PUBLISH_LIMITS, type PublishLimits } from '../domain/publish-limits.js';
import type {
  ArtifactBundle,
  ArtifactFile,
  PreparedChange,
  PullRequestResult,
  RepositoryGateway,
  RepositoryStatus,
} from '../domain/types.js';

interface SessionResponse {
  authenticated: boolean;
  configured: boolean;
  user: string | null;
  csrfToken?: string;
}

interface PrepareResponse {
  operationDigest: string;
  latestBaseSha: string;
  predecessor?: {number:number;url:string};
  recovered?: PullRequestResult;
  id: string;
  branch: string;
  baseSha: string;
  diff: string;
  changedFiles: Array<{
    text?: string;
    path: string;
    mimeType: string;
    byteLength: number;
    sha256: string;
  }>;
}

interface SerializedFile {
  path: string;
  mimeType: string;
  byteLength: number;
  sha256: string;
  contentBase64: string;
}

interface SerializedBundle {
  revalidation?: ArtifactBundle['revalidation'];
  recoveryBranch?: string;
  bundleId: string;
  generatorVersion: string;
  expectedBaseSha?: string;
  character: {
    id: string;
    slug: string;
    displayName: string;
  };
  files: SerializedFile[];
  prBody: string;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class RepositoryGatewayError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'RepositoryGatewayError';
  }
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let output = '';
  let index = 0;
  for (; index + 2 < bytes.length; index += 3) {
    const value = (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2];
    output +=
      BASE64_ALPHABET[(value >>> 18) & 63] +
      BASE64_ALPHABET[(value >>> 12) & 63] +
      BASE64_ALPHABET[(value >>> 6) & 63] +
      BASE64_ALPHABET[value & 63];
  }
  if (index < bytes.length) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const value = (first << 16) | (second << 8);
    output += BASE64_ALPHABET[(value >>> 18) & 63];
    output += BASE64_ALPHABET[(value >>> 12) & 63];
    output += index + 1 < bytes.length ? BASE64_ALPHABET[(value >>> 6) & 63] : '=';
    output += '=';
  }
  return output;
}

async function serializeFile(file: ArtifactFile): Promise<SerializedFile> {
  let blob: Blob;
  if (typeof file.text === 'string') {
    blob = new Blob([file.text], { type: file.mimeType });
  } else if (file.blob instanceof Blob) {
    blob = file.blob;
  } else {
    throw new RepositoryGatewayError(
      `${file.path} の内容がありません。生成をやり直してください。`,
      'file_content_missing',
      422,
    );
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    path: file.path,
    mimeType: file.mimeType,
    byteLength: bytes.byteLength,
    sha256: file.sha256,
    contentBase64: bytesToBase64(bytes),
  };
}

export async function serializeBundle(bundle: ArtifactBundle): Promise<SerializedBundle> {
  const files: SerializedFile[] = [];
  assertPublishSize(bundle.files);
  for (const file of bundle.files.filter(f => !f.path.startsWith('generated/content-studio-'))) files.push(await serializeFile(file));
  return {
    bundleId: bundle.bundleId,
    generatorVersion: bundle.generatorVersion,
    recoveryBranch: bundle.recoveryBranch,
    revalidation: bundle.revalidation,
    character: {
      id: bundle.character.id,
      slug: bundle.character.slug,
      displayName: bundle.character.displayName,
    },
    files,
    prBody: bundle.prBody,
  };
}

function normalizeBaseUrl(value: string): string {
  if (!value) return '';
  const normalized = value.replace(/\/$/, '');
  if (typeof location !== 'undefined') {
    const requested = new URL(normalized, location.origin);
    if (requested.origin !== location.origin) {
      throw new RepositoryGatewayError(
        'GitHubバックエンドは同一オリジンの /api として公開してください。',
        'cross_origin_backend_denied',
        400,
      );
    }
    return requested.origin === location.origin ? requested.pathname.replace(/\/$/, '') : '';
  }
  return normalized;
}

export class ServerRepositoryGateway implements RepositoryGateway {
  private readonly baseUrl: string;
  private csrfToken: string | null = null;
  private limits: PublishLimits = PUBLISH_LIMITS;
  private session: SessionResponse | null = null;

  constructor(
    baseUrl = '',
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  loginUrl(returnTo?: string): string {
    const safeReturnTo = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')
      ? returnTo
      : '/';
    return `${this.baseUrl}/api/auth/login?returnTo=${encodeURIComponent(safeReturnTo)}`;
  }

  beginLogin(returnTo?: string): void {
    if (typeof window === 'undefined') {
      throw new RepositoryGatewayError('ブラウザからログインしてください。', 'browser_required', 400);
    }
    window.location.assign(this.loginUrl(returnTo ?? `${location.pathname}${location.search}${location.hash}`));
  }

  async getStatus(): Promise<RepositoryStatus> {
    const session = await this.loadSession();
    if (!session.configured) {
      return {
        mode: 'server',
        connected: false,
        user: null,
        build: 'idle',
        deployment: 'unknown',
        message: '実GitHub連携は未設定です。モックモードを利用できます。',
      };
    }
    if (!session.authenticated) {
      return {
        mode: 'server',
        connected: false,
        user: null,
        build: 'idle',
        deployment: 'unknown',
        message: 'GitHubへログインしてください。',
      };
    }
    const status = await this.request<RepositoryStatus>('/api/github/status');
    if (status.publishLimits) this.limits = status.publishLimits;
    return status;
  }

  async prepare(bundle: ArtifactBundle): Promise<PreparedChange> {
    await this.ensureAuthenticated();
    await this.getStatus();
    assertPublishSize(bundle.files, this.limits);
    const response = await this.request<PrepareResponse>('/api/github/prepare', {
      method: 'POST',
      body: JSON.stringify(await serializeBundle(bundle)),
    });

    return {
      id: response.id,
      operationDigest: response.operationDigest,
      latestBaseSha: response.latestBaseSha,
      predecessor: response.predecessor,
      branch: response.branch,
      commitSha: response.baseSha,
      recovered: response.recovered,
      files: response.changedFiles.map(file => ({ ...file, kind: 'metadata' as const })),
      testStatus: 'success',
      diff: response.diff,
    };
  }

  async createPullRequest(
    prepared: PreparedChange,
    bundle: ArtifactBundle,
  ): Promise<PullRequestResult> {
    await this.ensureAuthenticated();
    return this.request<PullRequestResult>('/api/github/pull-requests', {
      method: 'POST',
      body: JSON.stringify({
        preparationId: prepared.id,
        bundle: await serializeBundle(bundle),
      }),
    });
  }

  async mergePullRequest(prepared: PreparedChange, result: PullRequestResult): Promise<PullRequestResult> {
    await this.ensureAuthenticated();
    return this.request<PullRequestResult>('/api/github/merge', {
      method: 'POST',
      body: JSON.stringify({
        preparationId: prepared.id,
        pullRequestNumber: result.number,
        expectedHeadSha: result.commitSha,
      }),
    });
  }

  async getChecks(ref: string): Promise<RepositoryStatus['build']> {
    await this.ensureAuthenticated();
    const result = await this.request<{ build: RepositoryStatus['build'] }>(
      `/api/github/checks?ref=${encodeURIComponent(ref)}`,
    );
    return result.build;
  }

  async getDeployment(ref: string): Promise<RepositoryStatus['deployment']> {
    await this.ensureAuthenticated();
    const result = await this.request<{ deployment: RepositoryStatus['deployment'] }>(
      `/api/github/deployment?ref=${encodeURIComponent(ref)}`,
    );
    return result.deployment;
  }

  async logout(): Promise<void> {
    const session = this.session ?? await this.loadSession();
    if (!session.authenticated) return;
    await this.request<{ ok: boolean }>('/api/auth/logout', { method: 'POST', body: '{}' });
    this.csrfToken = null;
    this.session = { authenticated: false, configured: session.configured, user: null };
  }

  private async ensureAuthenticated(): Promise<void> {
    const session = this.session?.authenticated ? this.session : await this.loadSession();
    if (!session.configured) {
      throw new RepositoryGatewayError(
        '実GitHub連携は未設定です。モックモードを利用してください。',
        'github_not_configured',
        503,
      );
    }
    if (!session.authenticated || !this.csrfToken) {
      throw new RepositoryGatewayError('GitHubへログインしてください。', 'session_required', 401);
    }
  }

  private async loadSession(): Promise<SessionResponse> {
    const session = await this.request<SessionResponse>('/api/auth/session');
    this.session = session;
    this.csrfToken = session.csrfToken ?? null;
    return session;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (typeof init.body === 'string') assertRequestSize(init.body, this.limits.maxRequestBytes);
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    if (init.body !== undefined) headers.set('content-type', 'application/json');
    if (init.method && init.method !== 'GET' && this.csrfToken) {
      headers.set('x-csrf-token', this.csrfToken);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        credentials: 'include',
        cache: 'no-store',
      });
    } catch {
      throw new RepositoryGatewayError(
        '通信できませんでした。接続を確認して再試行してください。',
        'network_error',
        0,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new RepositoryGatewayError('サーバー応答を読み込めませんでした。', 'response_invalid', response.status);
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) { this.session = null; this.csrfToken = null; }
      const error = typeof body === 'object' && body !== null
        ? (body as { error?: { code?: unknown; message?: unknown; requestId?: unknown } }).error
        : undefined;
      throw new RepositoryGatewayError(
        typeof error?.message === 'string' ? error.message : 'GitHub連携処理に失敗しました。',
        typeof error?.code === 'string' ? error.code : 'request_failed',
        response.status,
        typeof error?.requestId === 'string' ? error.requestId : undefined,
      );
    }
    return body as T;
  }
}

export function createServerRepositoryGateway(baseUrl = ''): ServerRepositoryGateway {
  return new ServerRepositoryGateway(baseUrl);
}
