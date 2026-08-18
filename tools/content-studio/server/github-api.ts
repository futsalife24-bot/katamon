import { createPrivateKey, createSign } from 'node:crypto';

import { HttpError } from './security.js';
import type {
  AuthenticatedUser,
  BuildState,
  Clock,
  DeploymentState,
  FetchLike,
  GitTreeEntry,
  ServerConfig,
} from './types.js';
import { systemClock } from './types.js';

interface GitHubErrorBody {
  message?: string;
  documentation_url?: string;
}

export class GitHubApiError extends HttpError {
  constructor(
    status: number,
    code: string,
    message: string,
    public readonly githubStatus: number,
  ) {
    super(status, code, message);
    this.name = 'GitHubApiError';
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GitHubApiError(502, 'github_invalid_response', `${label}の応答を確認できませんでした。`, 502);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new GitHubApiError(502, 'github_invalid_response', `${label}の応答を確認できませんでした。`, 502);
  }
  return value;
}

function encodedRef(ref: string): string {
  return ref.split('/').map(encodeURIComponent).join('/');
}

function mapGitHubFailure(status: number, body: GitHubErrorBody): GitHubApiError {
  if (status === 401) {
    return new GitHubApiError(502, 'github_auth_failed', 'GitHub Appの認証に失敗しました。', status);
  }
  if (status === 403 && body.message?.toLowerCase().includes('rate limit')) {
    return new GitHubApiError(503, 'github_rate_limited', 'GitHub側の利用上限に達しました。後で再試行してください。', status);
  }
  if (status === 403) {
    return new GitHubApiError(403, 'github_permission_denied', 'GitHub Appの権限が不足しています。', status);
  }
  if (status === 404) {
    return new GitHubApiError(404, 'github_not_found', '固定されたリポジトリまたは対象が見つかりません。', status);
  }
  if (status === 409 || status === 422) {
    return new GitHubApiError(409, 'github_conflict', 'GitHub上の変更と競合しました。下書きを再検証してください。', status);
  }
  return new GitHubApiError(502, 'github_request_failed', 'GitHubとの通信に失敗しました。', status);
}

export class GitHubClient {
  private installationToken: string | null = null;
  private installationTokenExpiresAt = 0;

  constructor(
    private readonly config: ServerConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly clock: Clock = systemClock,
  ) {}

  oauthAuthorizeUrl(state: string): string {
    const callback = new URL('/api/auth/callback', this.config.publicAppUrl);
    const url = new URL('/login/oauth/authorize', this.config.githubWebUrl);
    url.searchParams.set('client_id', this.config.githubOAuthClientId);
    url.searchParams.set('redirect_uri', callback.toString());
    url.searchParams.set('scope', 'read:user');
    url.searchParams.set('state', state);
    return url.toString();
  }

  async authenticateOAuthCode(code: string): Promise<AuthenticatedUser> {
    if (!/^[A-Za-z0-9_-]{8,512}$/.test(code)) {
      throw new HttpError(400, 'oauth_code_invalid', 'GitHubから受け取った認証情報が不正です。');
    }
    const tokenResponse = await this.fetchImpl(`${this.config.githubWebUrl}/login/oauth/access_token`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': 'Content-Studio-Backend/0.1',
      },
      body: JSON.stringify({
        client_id: this.config.githubOAuthClientId,
        client_secret: this.config.githubOAuthClientSecret,
        code,
        redirect_uri: new URL('/api/auth/callback', this.config.publicAppUrl).toString(),
      }),
    });
    const tokenBody = await this.readJson(tokenResponse);
    if (!tokenResponse.ok) throw mapGitHubFailure(tokenResponse.status, tokenBody as GitHubErrorBody);
    const accessToken = asString(asRecord(tokenBody, 'OAuth').access_token, 'OAuth');
    const userResponse = await this.fetchImpl(`${this.config.githubApiUrl}/user`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${accessToken}`,
        'user-agent': 'Content-Studio-Backend/0.1',
        'x-github-api-version': '2022-11-28',
      },
    });
    const userBody = await this.readJson(userResponse);
    if (!userResponse.ok) throw mapGitHubFailure(userResponse.status, userBody as GitHubErrorBody);
    const user = asRecord(userBody, 'ユーザー');
    const login = asString(user.login, 'ユーザー');
    if (!Number.isSafeInteger(user.id) || (user.id as number) <= 0) {
      throw new GitHubApiError(502, 'github_invalid_response', 'GitHubユーザーを確認できませんでした。', 502);
    }
    return { login, id: user.id as number };
  }

  async getBaseSha(): Promise<string> {
    const data = await this.request(
      `/repos/${this.repoPath()}/git/ref/heads/${encodedRef(this.config.githubBaseBranch)}`,
    );
    return asString(asRecord(asRecord(data, 'ブランチ').object, 'ブランチ').sha, 'ブランチ');
  }

  async getCommit(commitSha: string): Promise<{ sha: string; treeSha: string }> {
    const data = asRecord(
      await this.request(`/repos/${this.repoPath()}/git/commits/${encodeURIComponent(commitSha)}`),
      'コミット',
    );
    return {
      sha: asString(data.sha, 'コミット'),
      treeSha: asString(asRecord(data.tree, 'ツリー').sha, 'ツリー'),
    };
  }

  async getTree(treeSha: string): Promise<GitTreeEntry[]> {
    const data = asRecord(
      await this.request(`/repos/${this.repoPath()}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`),
      'ツリー',
    );
    if (data.truncated === true) {
      throw new GitHubApiError(409, 'github_tree_truncated', 'リポジトリ全体を安全に検査できませんでした。', 409);
    }
    if (!Array.isArray(data.tree)) {
      throw new GitHubApiError(502, 'github_invalid_response', 'GitHubのツリーを確認できませんでした。', 502);
    }
    return data.tree.map((entry) => {
      const record = asRecord(entry, 'ツリー');
      const type = asString(record.type, 'ツリー');
      if (type !== 'blob' && type !== 'tree' && type !== 'commit') {
        throw new GitHubApiError(502, 'github_invalid_response', 'GitHubのツリーを確認できませんでした。', 502);
      }
      return {
        path: asString(record.path, 'ツリー'),
        mode: asString(record.mode, 'ツリー'),
        type,
        sha: asString(record.sha, 'ツリー'),
        size: typeof record.size === 'number' ? record.size : undefined,
      };
    });
  }

  async getBlob(blobSha: string): Promise<Buffer> {
    const data = asRecord(
      await this.request(`/repos/${this.repoPath()}/git/blobs/${encodeURIComponent(blobSha)}`),
      'Blob',
    );
    if (data.encoding !== 'base64') {
      throw new GitHubApiError(502, 'github_invalid_response', 'GitHubのファイルを確認できませんでした。', 502);
    }
    const content = asString(data.content, 'Blob').replace(/\s/g, '');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) {
      throw new GitHubApiError(502, 'github_invalid_response', 'GitHubのファイルを確認できませんでした。', 502);
    }
    return Buffer.from(content, 'base64');
  }

  async createBlob(bytes: Buffer): Promise<string> {
    const data = asRecord(
      await this.request(`/repos/${this.repoPath()}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: bytes.toString('base64'), encoding: 'base64' }),
      }),
      'Blob',
    );
    return asString(data.sha, 'Blob');
  }

  async createTree(
    baseTreeSha: string,
    entries: Array<{ path: string; sha: string }>,
  ): Promise<string> {
    const data = asRecord(
      await this.request(`/repos/${this.repoPath()}/git/trees`, {
        method: 'POST',
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: entries.map((entry) => ({
            path: entry.path,
            mode: '100644',
            type: 'blob',
            sha: entry.sha,
          })),
        }),
      }),
      'ツリー',
    );
    return asString(data.sha, 'ツリー');
  }

  async createCommit(
    message: string,
    treeSha: string,
    parentSha: string,
  ): Promise<string> {
    const data = asRecord(
      await this.request(`/repos/${this.repoPath()}/git/commits`, {
        method: 'POST',
        body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
      }),
      'コミット',
    );
    return asString(data.sha, 'コミット');
  }

  async createBranch(branch: string, commitSha: string): Promise<void> {
    await this.request(`/repos/${this.repoPath()}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitSha }),
    });
  }

  async createPullRequest(input: {
    branch: string;
    title: string;
    body: string;
  }): Promise<{ number: number; url: string }> {
    const data = asRecord(
      await this.request(`/repos/${this.repoPath()}/pulls`, {
        method: 'POST',
        body: JSON.stringify({
          title: input.title,
          head: input.branch,
          base: this.config.githubBaseBranch,
          body: input.body,
          draft: false,
        }),
      }),
      'PR',
    );
    if (!Number.isSafeInteger(data.number) || (data.number as number) <= 0) {
      throw new GitHubApiError(502, 'github_invalid_response', '作成したPRを確認できませんでした。', 502);
    }
    return { number: data.number as number, url: asString(data.html_url, 'PR') };
  }

  async findOpenPullRequest(branch: string): Promise<{ number: number; url: string } | null> {
    const head = `${this.config.githubOwner}:${branch}`;
    const data = await this.request(
      `/repos/${this.repoPath()}/pulls?state=open&head=${encodeURIComponent(head)}&base=${encodeURIComponent(this.config.githubBaseBranch)}&per_page=1`,
    );
    if (!Array.isArray(data) || data.length === 0) return null;
    const pr = asRecord(data[0], 'PR');
    if (!Number.isSafeInteger(pr.number) || (pr.number as number) <= 0) return null;
    return { number: pr.number as number, url: asString(pr.html_url, 'PR') };
  }

  async getPullRequest(number: number): Promise<{
    number: number;
    url: string;
    state: 'open' | 'closed';
    baseRef: string;
    headRef: string;
    headSha: string;
    merged: boolean;
  }> {
    const data = asRecord(
      await this.request(`/repos/${this.repoPath()}/pulls/${number}`),
      'PR',
    );
    if (!Number.isSafeInteger(data.number) || data.number !== number) {
      throw new GitHubApiError(502, 'github_invalid_response', 'GitHubのPR番号を確認できませんでした。', 502);
    }
    const state = asString(data.state, 'PR');
    if (state !== 'open' && state !== 'closed') {
      throw new GitHubApiError(502, 'github_invalid_response', 'GitHubのPR状態を確認できませんでした。', 502);
    }
    return {
      number,
      url: asString(data.html_url, 'PR'),
      state,
      baseRef: asString(asRecord(data.base, 'PR base').ref, 'PR base'),
      headRef: asString(asRecord(data.head, 'PR head').ref, 'PR head'),
      headSha: asString(asRecord(data.head, 'PR head').sha, 'PR head'),
      merged: data.merged === true,
    };
  }

  async mergePullRequest(number: number, expectedHeadSha: string): Promise<{ merged: true }> {
    const data = asRecord(
      await this.request(`/repos/${this.repoPath()}/pulls/${number}/merge`, {
        method: 'PUT',
        body: JSON.stringify({ sha: expectedHeadSha, merge_method: 'squash' }),
      }),
      'PR merge',
    );
    if (data.merged !== true) {
      throw new GitHubApiError(409, 'github_merge_rejected', 'PRを安全にマージできませんでした。競合とCI状態を確認してください。', 409);
    }
    return { merged: true };
  }

  async getChecks(ref: string): Promise<BuildState> {
    const data = asRecord(
      await this.request(
        `/repos/${this.repoPath()}/commits/${encodeURIComponent(ref)}/check-runs?per_page=100`,
      ),
      'Checks',
    );
    if (!Array.isArray(data.check_runs) || data.check_runs.length === 0) return 'idle';
    const runs = data.check_runs.map((run) => asRecord(run, 'Checks'));
    if (runs.some((run) => run.status === 'in_progress')) return 'running';
    if (runs.some((run) => run.status === 'queued' || run.status === 'requested' || run.status === 'waiting')) {
      return 'queued';
    }
    const successful = new Set(['success', 'neutral', 'skipped']);
    return runs.every((run) => typeof run.conclusion === 'string' && successful.has(run.conclusion))
      ? 'success'
      : 'failure';
  }

  async getDeployment(ref: string): Promise<DeploymentState> {
    const deployments = await this.request(
      `/repos/${this.repoPath()}/deployments?sha=${encodeURIComponent(ref)}&per_page=5`,
    );
    if (!Array.isArray(deployments) || deployments.length === 0) return 'unknown';
    const deployment = asRecord(deployments[0], 'Deployment');
    if (!Number.isSafeInteger(deployment.id)) return 'unknown';
    const statuses = await this.request(
      `/repos/${this.repoPath()}/deployments/${deployment.id as number}/statuses?per_page=1`,
    );
    if (!Array.isArray(statuses) || statuses.length === 0) return 'pending';
    const state = asRecord(statuses[0], 'Deployment').state;
    if (state === 'success') return 'published';
    if (state === 'failure' || state === 'error' || state === 'inactive') return 'failure';
    return 'pending';
  }

  private repoPath(): string {
    return `${encodeURIComponent(this.config.githubOwner)}/${encodeURIComponent(this.config.githubRepo)}`;
  }

  private createAppJwt(): string {
    const seconds = Math.floor(this.clock.now() / 1_000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ iat: seconds - 60, exp: seconds + 9 * 60, iss: this.config.githubAppId }),
    ).toString('base64url');
    const signingInput = `${header}.${payload}`;
    let signature: Buffer;
    try {
      const signer = createSign('RSA-SHA256');
      signer.update(signingInput);
      signer.end();
      signature = signer.sign(createPrivateKey(this.config.githubPrivateKey));
    } catch {
      throw new HttpError(503, 'github_app_key_invalid', 'GitHub Appの秘密鍵を読み込めませんでした。');
    }
    return `${signingInput}.${signature.toString('base64url')}`;
  }

  private async getInstallationToken(): Promise<string> {
    if (this.installationToken && this.installationTokenExpiresAt > this.clock.now() + 60_000) {
      return this.installationToken;
    }
    const response = await this.fetchImpl(
      `${this.config.githubApiUrl}/app/installations/${encodeURIComponent(this.config.githubInstallationId)}/access_tokens`,
      {
        method: 'POST',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${this.createAppJwt()}`,
          'content-type': 'application/json',
          'user-agent': 'Content-Studio-Backend/0.1',
          'x-github-api-version': '2022-11-28',
        },
        body: JSON.stringify({}),
      },
    );
    const body = await this.readJson(response);
    if (!response.ok) throw mapGitHubFailure(response.status, body as GitHubErrorBody);
    const record = asRecord(body, 'Installation token');
    this.installationToken = asString(record.token, 'Installation token');
    const expiresAt = Date.parse(asString(record.expires_at, 'Installation token'));
    if (!Number.isFinite(expiresAt)) {
      this.installationToken = null;
      throw new GitHubApiError(502, 'github_invalid_response', 'GitHub Appの認証期限を確認できませんでした。', 502);
    }
    this.installationTokenExpiresAt = expiresAt;
    return this.installationToken;
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const token = await this.getInstallationToken();
    const response = await this.fetchImpl(`${this.config.githubApiUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'Content-Studio-Backend/0.1',
        'x-github-api-version': '2022-11-28',
        ...init.headers,
      },
    });
    const body = await this.readJson(response);
    if (!response.ok) throw mapGitHubFailure(response.status, body as GitHubErrorBody);
    return body;
  }

  private async readJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new GitHubApiError(502, 'github_invalid_response', 'GitHubから不正な応答を受け取りました。', response.status);
    }
  }
}
