import { randomBytes } from 'node:crypto';

import type { GitHubClient } from './github-api.js';
import { HttpError } from './security.js';
import type {
  BuildState,
  Clock,
  DeploymentState,
  GitTreeEntry,
  PreparedRecord,
  ServerConfig,
  ValidatedBundle,
  ValidatedFile,
} from './types.js';
import { systemClock } from './types.js';

interface RepositoryGitHub {
  getBaseSha(): Promise<string>;
  getCommit(commitSha: string): Promise<{ sha: string; treeSha: string }>;
  getTree(treeSha: string): Promise<GitTreeEntry[]>;
  getBlob(blobSha: string): Promise<Buffer>;
  createBlob(bytes: Buffer): Promise<string>;
  createTree(baseTreeSha: string, entries: Array<{ path: string; sha: string }>): Promise<string>;
  createCommit(message: string, treeSha: string, parentSha: string): Promise<string>;
  createBranch(branch: string, commitSha: string): Promise<void>;
  createPullRequest(input: {
    branch: string;
    title: string;
    body: string;
  }): Promise<{ number: number; url: string }>;
  findOpenPullRequest(branch: string): Promise<{ number: number; url: string } | null>;
  getPullRequest(number: number): Promise<{
    number: number;
    url: string;
    state: 'open' | 'closed';
    baseRef: string;
    headRef: string;
    headSha: string;
    merged: boolean;
  }>;
  mergePullRequest(number: number, expectedHeadSha: string): Promise<{ merged: true }>;
  getChecks(ref: string): Promise<BuildState>;
  getDeployment(ref: string): Promise<DeploymentState>;
}

interface BaseInspection {
  baseSha: string;
  treeSha: string;
  entries: Map<string, GitTreeEntry>;
  changedFiles: ValidatedFile[];
  diff: string;
}

export interface PrepareResult {
  id: string;
  branch: string;
  baseSha: string;
  diff: string;
  changedFiles: Array<{
    path: string;
    mimeType: string;
    byteLength: number;
    sha256: string;
  }>;
}

export interface PullRequestServiceResult {
  number: number;
  url: string;
  branch: string;
  commitSha: string;
  checks: BuildState;
  deployment: DeploymentState;
  merged?: boolean;
  mergedAt?: string;
}

class PreparationStore {
  private readonly records = new Map<string, PreparedRecord>();

  constructor(private readonly clock: Clock = systemClock) {}

  create(input: Omit<PreparedRecord, 'id'>): PreparedRecord {
    this.cleanup();
    const id = randomBytes(24).toString('base64url');
    const record: PreparedRecord = { id, ...input };
    this.records.set(id, record);
    return record;
  }

  get(id: string): PreparedRecord {
    const record = this.records.get(id);
    if (!record || record.expiresAt <= this.clock.now()) {
      if (record) this.records.delete(id);
      throw new HttpError(410, 'preparation_expired', '公開準備の有効期限が切れました。もう一度検証してください。');
    }
    return record;
  }

  private cleanup(): void {
    const now = this.clock.now();
    for (const [id, record] of this.records) {
      if (record.expiresAt <= now) this.records.delete(id);
    }
  }
}

export class RepositoryService {
  private readonly preparations: PreparationStore;

  constructor(
    private readonly config: ServerConfig,
    private readonly github: RepositoryGitHub | GitHubClient,
    private readonly clock: Clock = systemClock,
  ) {
    this.preparations = new PreparationStore(clock);
  }

  async getStatus(): Promise<{
    baseSha: string;
    build: BuildState;
    deployment: DeploymentState;
  }> {
    const baseSha = await this.github.getBaseSha();
    const [checks, deployment] = await Promise.allSettled([
      this.github.getChecks(baseSha),
      this.github.getDeployment(baseSha),
    ]);
    return {
      baseSha,
      build: checks.status === 'fulfilled' ? checks.value : 'idle',
      deployment: deployment.status === 'fulfilled' ? deployment.value : 'unknown',
    };
  }

  async prepare(bundle: ValidatedBundle, actorKey: string): Promise<PrepareResult> {
    const inspection = await this.inspectBase(bundle, bundle.expectedBaseSha);
    const timestamp = new Date(this.clock.now()).toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const branchSuffix = randomBytes(4).toString('hex');
    const branch = `studio/add-character-${bundle.character.slug}-${timestamp}-${branchSuffix}`;
    const record = this.preparations.create({
      actorKey,
      bundleDigest: bundle.digest,
      slug: bundle.character.slug,
      baseSha: inspection.baseSha,
      branch,
      expiresAt: this.clock.now() + this.config.preparationTtlMs,
    });
    return {
      id: record.id,
      branch,
      baseSha: inspection.baseSha,
      diff: inspection.diff,
      changedFiles: inspection.changedFiles.map((file) => ({
        path: file.path,
        mimeType: file.mimeType,
        byteLength: file.bytes.length,
        sha256: file.sha256,
      })),
    };
  }

  async createPullRequest(
    preparationId: string,
    bundle: ValidatedBundle,
    actorKey: string,
  ): Promise<PullRequestServiceResult> {
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(preparationId)) {
      throw new HttpError(422, 'preparation_invalid', '公開準備IDが不正です。');
    }
    const prepared = this.preparations.get(preparationId);
    if (prepared.actorKey !== actorKey || prepared.bundleDigest !== bundle.digest || prepared.slug !== bundle.character.slug) {
      throw new HttpError(403, 'preparation_mismatch', '公開準備と送信内容が一致しません。');
    }
    if (prepared.result) return prepared.result;

    let commitSha = prepared.pendingCommitSha;
    if (!commitSha) {
      const inspection = await this.inspectBase(bundle, prepared.baseSha);
      const blobEntries: Array<{ path: string; sha: string }> = [];
      for (const file of inspection.changedFiles) {
        blobEntries.push({ path: file.path, sha: await this.github.createBlob(file.bytes) });
      }
      const treeSha = await this.github.createTree(inspection.treeSha, blobEntries);
      await this.assertBaseUnchanged(prepared.baseSha);
      commitSha = await this.github.createCommit(
        `content-studio: update ${bundle.character.slug}`,
        treeSha,
        prepared.baseSha,
      );
      await this.assertBaseUnchanged(prepared.baseSha);
      await this.github.createBranch(prepared.branch, commitSha);
      prepared.pendingCommitSha = commitSha;
    }

    let pullRequest = await this.github.findOpenPullRequest(prepared.branch);
    if (!pullRequest) {
      pullRequest = await this.github.createPullRequest({
        branch: prepared.branch,
        title: `Content Studio: ${bundle.character.displayName}`,
        body: bundle.prBody,
      });
    }
    const [checks, deployment] = await Promise.allSettled([
      this.github.getChecks(commitSha),
      this.github.getDeployment(commitSha),
    ]);
    const result: PullRequestServiceResult = {
      number: pullRequest.number,
      url: pullRequest.url,
      branch: prepared.branch,
      commitSha,
      checks: checks.status === 'fulfilled' ? checks.value : 'queued',
      deployment: deployment.status === 'fulfilled' ? deployment.value : 'pending',
    };
    prepared.result = result;
    return result;
  }

  async mergePullRequest(
    preparationId: string,
    pullRequestNumber: number,
    expectedHeadSha: string,
    actorKey: string,
  ): Promise<PullRequestServiceResult> {
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(preparationId)) {
      throw new HttpError(422, 'preparation_invalid', '公開準備IDが不正です。');
    }
    if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber <= 0) {
      throw new HttpError(422, 'pull_request_invalid', 'PR番号が不正です。');
    }
    if (!/^[a-f0-9]{40}$/.test(expectedHeadSha)) {
      throw new HttpError(422, 'head_sha_invalid', 'PRのコミットSHAが不正です。');
    }

    const prepared = this.preparations.get(preparationId);
    if (prepared.actorKey !== actorKey) {
      throw new HttpError(403, 'preparation_mismatch', '公開準備とログイン中の管理者が一致しません。');
    }
    const result = prepared.result;
    if (!result) {
      throw new HttpError(409, 'pull_request_not_created', '先にPRを作成してください。');
    }
    if (
      result.number !== pullRequestNumber
      || result.commitSha !== expectedHeadSha
      || result.branch !== prepared.branch
    ) {
      throw new HttpError(409, 'pull_request_mismatch', '公開準備とPRが一致しません。');
    }
    if (result.merged) return result;

    const checks = await this.github.getChecks(expectedHeadSha);
    result.checks = checks;
    if (checks !== 'success') {
      throw new HttpError(409, 'checks_not_successful', 'CIが成功していないためマージを中止しました。');
    }

    const pullRequest = await this.github.getPullRequest(pullRequestNumber);
    if (
      pullRequest.baseRef !== this.config.githubBaseBranch
      || pullRequest.headRef !== prepared.branch
      || pullRequest.headSha !== expectedHeadSha
    ) {
      throw new HttpError(409, 'pull_request_changed', 'PRの対象またはコミットが変わったためマージを中止しました。');
    }
    if (!pullRequest.merged && pullRequest.state !== 'open') {
      throw new HttpError(409, 'pull_request_not_open', 'PRが開いていないためマージできません。');
    }
    if (!pullRequest.merged) {
      await this.github.mergePullRequest(pullRequestNumber, expectedHeadSha);
    }

    const mergedResult: PullRequestServiceResult = {
      ...result,
      checks: 'success',
      merged: true,
      mergedAt: new Date(this.clock.now()).toISOString(),
    };
    prepared.result = mergedResult;
    return mergedResult;
  }

  private async inspectBase(
    bundle: ValidatedBundle,
    expectedBaseSha: string | undefined,
  ): Promise<BaseInspection> {
    const baseSha = await this.github.getBaseSha();
    if (expectedBaseSha && baseSha !== expectedBaseSha) {
      throw new HttpError(409, 'base_sha_conflict', '基準ブランチが更新されています。再検証してください。');
    }
    const commit = await this.github.getCommit(baseSha);
    const tree = await this.github.getTree(commit.treeSha);
    const entries = new Map<string, GitTreeEntry>();
    const lowerPaths = new Map<string, string>();
    for (const entry of tree) {
      if (entry.type !== 'blob') continue;
      entries.set(entry.path, entry);
      const lower = entry.path.toLowerCase();
      const previous = lowerPaths.get(lower);
      if (previous && previous !== entry.path) {
        throw new HttpError(409, 'repository_case_collision', 'リポジトリに大文字小文字の衝突があります。');
      }
      lowerPaths.set(lower, entry.path);
    }
    for (const file of bundle.files) {
      const collision = lowerPaths.get(file.path.toLowerCase());
      if (collision && collision !== file.path) {
        throw new HttpError(409, 'path_case_collision', '大文字小文字だけが異なる既存パスがあります。');
      }
    }
    await this.assertCharacterIdentity(bundle, tree);

    const changedFiles = bundle.files.filter((file) => entries.get(file.path)?.sha !== file.gitBlobSha);
    for (const file of changedFiles) {
      if (file.path.startsWith('assets/content-studio/') && entries.has(file.path)) {
        throw new HttpError(409, 'asset_overwrite_denied', '既存画像と同じパスへの上書きは許可されていません。');
      }
    }
    if (changedFiles.length === 0) {
      throw new HttpError(409, 'no_changes', 'GitHubへ反映する変更がありません。');
    }
    const diff = changedFiles
      .map((file) => `${entries.has(file.path) ? '~' : '+'} ${file.path} (${file.bytes.length} bytes)`)
      .join('\n');
    return { baseSha, treeSha: commit.treeSha, entries, changedFiles, diff };
  }

  private async assertCharacterIdentity(bundle: ValidatedBundle, tree: GitTreeEntry[]): Promise<void> {
    const canonicalEntries = tree.filter(
      (entry) => entry.type === 'blob' && /^content\/characters\/[a-z0-9-]+\.json$/.test(entry.path),
    );
    if (canonicalEntries.length > 500) {
      throw new HttpError(409, 'character_catalog_too_large', '既存キャラクターを安全に照合できませんでした。');
    }
    const targetPath = `content/characters/${bundle.character.slug}.json`;
    for (const entry of canonicalEntries) {
      const bytes = await this.github.getBlob(entry.sha);
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch {
        throw new HttpError(409, 'existing_character_invalid', '既存の正規キャラクターデータを安全に照合できません。');
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new HttpError(409, 'existing_character_invalid', '既存の正規キャラクターデータを安全に照合できません。');
      }
      const record = parsed as Record<string, unknown>;
      const candidate = typeof record.character === 'object' && record.character !== null && !Array.isArray(record.character)
        ? record.character as Record<string, unknown>
        : record;
      if (typeof candidate.id !== 'string' || typeof candidate.slug !== 'string') {
        throw new HttpError(409, 'existing_character_invalid', '既存の正規キャラクターデータを安全に照合できません。');
      }
      const sameId = candidate.id.toLowerCase() === bundle.character.id.toLowerCase();
      if (entry.path !== targetPath && sameId) {
        throw new HttpError(409, 'character_id_conflict', '既存キャラクターと内部IDが重複しています。');
      }
      if (entry.path === targetPath && candidate.id !== bundle.character.id) {
        throw new HttpError(409, 'character_identity_conflict', '更新対象の内部IDが既存データと一致しません。');
      }
    }
  }

  private async assertBaseUnchanged(expected: string): Promise<void> {
    if (await this.github.getBaseSha() !== expected) {
      throw new HttpError(409, 'base_sha_conflict', '基準ブランチが処理中に更新されました。再検証してください。');
    }
  }
}
