import { requiredChecksFromProtection, type RequiredCheck } from './ci-policy.js';
import { readBoundedJson } from '../src/domain/bounded-json.js';
import { createPrivateKey, createSign } from 'node:crypto';

import { REQUIRED_STUDIO_CHECKS, GITHUB_ACTIONS_APP_ID, safeMergeProtection } from './ci-policy.js';
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

  async getCommit(commitSha: string): Promise<{ sha: string; treeSha: string; parents: string[]; message: string }> {
    const data = asRecord(
      await this.request(`/repos/${this.repoPath()}/git/commits/${encodeURIComponent(commitSha)}`),
      'コミット',
    );
    return {
      sha: asString(data.sha, 'コミット'),
      treeSha: asString(asRecord(data.tree, 'ツリー').sha, 'ツリー'),
      parents: Array.isArray(data.parents) ? data.parents.map(p => asString(asRecord(p, 'parent').sha, 'parent')) : [],
      message: asString(data.message, 'commit message'),
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
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(content)) {
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

  async findPullRequest(branch: string): Promise<{ number: number; url: string } | null> {
    const head = `${this.config.githubOwner}:${branch}`;
    const data = await this.request(
      `/repos/${this.repoPath()}/pulls?state=all&head=${encodeURIComponent(head)}&base=${encodeURIComponent(this.config.githubBaseBranch)}&per_page=100`,
    );
    if (!Array.isArray(data)) throw new HttpError(502, 'pull_requests_invalid', 'PR一覧を確認できません。');
    if (data.length === 0) return null;
    if (data.length !== 1) throw new HttpError(409, 'ambiguous_pr', '同じ公開操作のPRを一意に確認できません。');
    const pr = asRecord(data[0], 'PR');
    if (!Number.isSafeInteger(pr.number) || (pr.number as number) <= 0) throw new HttpError(502, 'pull_requests_invalid', 'PR番号を確認できません。');
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
    baseRepo: string; headRepo: string; baseSha: string; mergeCommitSha: string | null;
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
      baseRepo: asString(asRecord(asRecord(data.base, 'base').repo, 'base repo').full_name, 'repo'),
      headRepo: asString(asRecord(asRecord(data.head, 'head').repo, 'head repo').full_name, 'repo'),
      baseSha: asString(asRecord(data.base, 'base').sha, 'base sha'),
      mergeCommitSha: data.merged === true ? asString(data.merge_commit_sha, 'merge sha') : null,
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

  async getBranchSha(branch: string): Promise<string | null> {
    try {
      const data = asRecord(await this.request(`/repos/${this.repoPath()}/git/ref/heads/${encodedRef(branch)}`), 'branch');
      return asString(asRecord(data.object, 'branch').sha, 'branch');
    } catch (error) { if (error instanceof GitHubApiError && error.githubStatus === 404) return null; throw error; }
  }

  async getMergeProtection(): Promise<{ safe: boolean; requirements: RequiredCheck[]; reason?: string }> {
    try {
      const data = await this.request(`/repos/${this.repoPath()}/branches/${encodedRef(this.config.githubBaseBranch)}/protection`);
      try { return {safe:safeMergeProtection(data),requirements:requiredChecksFromProtection(data)}; }
      catch(error) {return {safe:false,requirements:[],reason:error instanceof Error?error.message:'必須CI設定が不正です。'};}
    } catch { return {safe:false,requirements:[],reason:'ブランチ保護設定を取得できません。'}; }
  }

  private async pages(path: string, key?: string): Promise<Record<string, unknown>[]> {
    const result: Record<string, unknown>[] = [];
    for (let page = 1; page <= 20; page++) {
      const data = await this.request(`/repos/${this.repoPath()}/${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const items = key ? asRecord(data, key)[key] : data;
      if (!Array.isArray(items)) throw new HttpError(502, 'checks_invalid', 'CI一覧を取得できません。');
      result.push(...items.map(v => asRecord(v, 'CI')));
      if (items.length < 100) return result;
    }
    throw new HttpError(409, 'checks_truncated', 'CI一覧を最後まで確認できません。');
  }

  async getChecks(ref: string, requirements: readonly RequiredCheck[] = []): Promise<BuildState> {
    const runs = await this.pages(`actions/workflows/content-studio.yml/runs?head_sha=${encodeURIComponent(ref)}`, 'workflow_runs');
    const latest = runs.filter(r => r.head_sha === ref && (r.event === 'pull_request' || r.event === 'push' || r.event === 'workflow_dispatch'))
      .sort((a,b) => String(b.run_started_at ?? '').localeCompare(String(a.run_started_at ?? '')) || Number(b.id) - Number(a.id))[0];
    if (!latest) return 'queued';
    if (!Number.isSafeInteger(latest.id) || !Number.isSafeInteger(latest.run_attempt)) return 'failure';
    const [jobs, checks, statuses] = await Promise.all([
      this.pages(`actions/runs/${latest.id}/attempts/${latest.run_attempt}/jobs`, 'jobs'),
      this.pages(`commits/${encodeURIComponent(ref)}/check-runs?filter=all`, 'check_runs'),
      this.pages(`commits/${encodeURIComponent(ref)}/statuses`),
    ]);
    for (const name of REQUIRED_STUDIO_CHECKS) {
      const matching = jobs.filter(j => j.name === name);
      if (!matching.length) return 'queued';
      if (matching.length !== 1) return 'failure';
      const job = matching[0];
      if (job.head_sha !== ref || job.run_id !== latest.id || (job.run_attempt !== undefined && job.run_attempt !== latest.run_attempt)) return 'failure';
      if (job.status !== 'completed') return job.status === 'in_progress' ? 'running' : 'queued';
      if (job.conclusion !== 'success') return 'failure';
      const id = Number(String(job.check_run_url).split('/').pop());
      const check = checks.find(c => c.id === id);
      if (!check || check.head_sha !== ref || check.name !== name || asRecord(check.app, 'check app').id !== GITHUB_ACTIONS_APP_ID || check.status !== 'completed' || check.conclusion !== 'success') return 'failure';
    }
    const latestStatuses = new Map<string, Record<string, unknown>>();
    for (const status of statuses.sort((a,b) => Number(b.id) - Number(a.id))) {
      if (typeof status.context !== 'string' || (status.sha !== undefined ? status.sha !== ref : !String(status.url).endsWith('/statuses/' + ref))) return 'failure';
      if (!latestStatuses.has(status.context)) latestStatuses.set(status.context, status);
    }
    let actionRuns: Record<string,unknown>[] | undefined;
    const jobCache = new Map<string,Record<string,unknown>[]>();
    const unsupported = (message:string):never => { throw new HttpError(409,'required_checks_unsupported',message); };
    const newest = (values:Record<string,unknown>[]) => [...values].sort((a,b)=>Number(b.id)-Number(a.id))[0];
    for (const requirement of requirements) {
      const {context,appId} = requirement;
      if(typeof context!=='string'||!context||!(appId===null||(Number.isSafeInteger(appId)&&appId>0))) unsupported('必須CI設定の形式が未対応です。管理者に設定確認を依頼してください。');
      if ((REQUIRED_STUDIO_CHECKS as readonly string[]).includes(context)) {
        if(appId!==GITHUB_ACTIONS_APP_ID) unsupported('Studio必須CIの実行元がGitHub Actionsに固定されていません。');
        continue;
      }
      const named = checks.filter(c=>c.name===context);
      if(named.some(c=>c.head_sha!==ref)) return 'failure';
      const eligible = named.filter(c=>appId===null || asRecord(c.app,'check app').id===appId);
      if(named.length && !eligible.length) return 'failure';
      if(eligible.some(c=>!Number.isSafeInteger(c.id)||(c.id as number)<=0)) unsupported('追加必須checkの実行IDを確認できません。');
      const sources = new Set(eligible.map(c=>asRecord(c.app,'check app').id));
      if(sources.size>1) unsupported('同名checkの実行元が複数あります。保護設定で実行元を固定してください。');
      let check = newest(eligible);
      if(check && asRecord(check.app,'check app').id===GITHUB_ACTIONS_APP_ID) {
        // A new workflow attempt can exist before its jobs/check-runs appear. Old green evidence must not substitute.
        actionRuns ??= await this.pages(`actions/runs?head_sha=${encodeURIComponent(ref)}`,'workflow_runs');
        const owningRuns = actionRuns.filter(r=>eligible.some(c=>asRecord(c.check_suite,'check suite').id===r.check_suite_id));
        const workflows = new Set(owningRuns.map(r=>r.workflow_id));
        if(workflows.size!==1) unsupported('追加必須checkのworkflowを一意に特定できません。');
        const run = [...actionRuns].filter(r=>r.workflow_id===owningRuns[0].workflow_id && r.head_sha===ref)
          .sort((a,b)=>String(b.run_started_at??'').localeCompare(String(a.run_started_at??''))||Number(b.id)-Number(a.id))[0];
        if(!run || !Number.isSafeInteger(run.id)||!Number.isSafeInteger(run.run_attempt)) unsupported('追加必須checkの最新実行を確認できません。');
        const key=String(run.id)+':'+run.run_attempt;
        if(!jobCache.has(key))jobCache.set(key,await this.pages(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`,'jobs'));
        const matching=jobCache.get(key)!.filter(j=>j.name===context);
        if(!matching.length)return 'queued';
        if(matching.length!==1)unsupported('同名必須jobが複数あり判定できません。');
        const job=matching[0];
        if(job.head_sha!==ref||job.run_id!==run.id||(job.run_attempt!==undefined&&job.run_attempt!==run.run_attempt))return 'failure';
        if(job.status!=='completed')return job.status==='in_progress'?'running':'queued';
        if(job.conclusion!=='success')return 'failure';
        check=eligible.find(c=>c.id===Number(String(job.check_run_url).split('/').pop()))!;
        if(!check)return 'failure';
        if(run.status!=='completed')return 'running';
        if(run.conclusion!=='success')return 'failure';
      }
      if(check) {
        if(check.status!=='completed')return check.status==='in_progress'?'running':'queued';
        if(check.conclusion!=='success')return 'failure';
      }
      const status=latestStatuses.get(context);
      // The status API does not attest an integration app ID. Never invent one from a bot login.
      if(status && appId!==null) unsupported('app固定の必須名にcommit statusも存在します。status APIでは実行元を証明できません。checkとstatusを別名で設定してください。');
      if(!check && !status)return 'queued';
      if(status && status.state!=='success')return status.state==='pending'?'queued':'failure';
    }
    for (const status of latestStatuses.values()) if (status.state !== 'success') return status.state === 'pending' ? 'queued' : 'failure';
    if (latest.status !== 'completed') return 'running';
    return latest.conclusion === 'success' ? 'success' : 'failure';
  }

  async getDeployment(ref: string): Promise<DeploymentState> {
    const deployments = await this.request(
      `/repos/${this.repoPath()}/deployments?sha=${encodeURIComponent(ref)}&environment=github-pages&per_page=100`,
    );
    if (!Array.isArray(deployments) || deployments.length === 0) return 'unknown';
    const matching = deployments.map(d => asRecord(d, 'Deployment')).filter(d => d.sha === ref && d.environment === 'github-pages').sort((a,b) => Number(b.id) - Number(a.id));
    if (!matching.length) return 'unknown';
    const deployment = matching[0];
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
    try {
      return await readBoundedJson(response, this.config.maxRequestBytes);
    } catch {
      throw new GitHubApiError(502, 'github_invalid_response', 'GitHubから不正な応答を受け取りました。', response.status);
    }
  }
}
