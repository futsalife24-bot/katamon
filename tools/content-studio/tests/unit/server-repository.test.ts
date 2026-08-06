import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { GitHubClient } from '../../server/github-api.js';
import { RepositoryService } from '../../server/repository-service.js';
import { HttpError } from '../../server/security.js';
import type { BuildState, Clock, DeploymentState, GitTreeEntry } from '../../server/types.js';
import { serverTestConfig, validatedBundle } from './server-fixtures.js';

class FixedClock implements Clock {
  constructor(private readonly value: number) {}
  now(): number {
    return this.value;
  }
}

class FakeRepositoryGitHub {
  baseSha = 'a'.repeat(40);
  tree: GitTreeEntry[] = [];
  blobs = 0;
  trees = 0;
  commits = 0;
  branches: string[] = [];
  pullRequests = 0;

  async getBaseSha() { return this.baseSha; }
  async getCommit(commitSha: string) { return { sha: commitSha, treeSha: 'b'.repeat(40) }; }
  async getTree() { return this.tree; }
  async getBlob() { return Buffer.from('{}'); }
  async createBlob() { this.blobs += 1; return 'c'.repeat(40); }
  async createTree(_base: string, entries: Array<{ path: string; sha: string }>) {
    this.trees += 1;
    expect(entries).toHaveLength(1);
    return 'd'.repeat(40);
  }
  async createCommit(message: string) {
    this.commits += 1;
    expect(message).toBe('content-studio: update sample-unit');
    return 'e'.repeat(40);
  }
  async createBranch(branch: string) {
    this.branches.push(branch);
  }
  async createPullRequest(input: { branch: string; title: string; body: string }) {
    this.pullRequests += 1;
    expect(input.branch).toMatch(/^studio\/add-character-sample-unit-/);
    expect(input.title).toBe('Content Studio: サンプルキャラクター');
    return { number: 42, url: 'https://github.invalid/pull/42' };
  }
  async findOpenPullRequest() { return null; }
  async getChecks(): Promise<BuildState> { return 'queued'; }
  async getDeployment(): Promise<DeploymentState> { return 'pending'; }
}

describe('GitHub repository service', () => {
  it('prepareは非破壊で、PR時だけ新branch・1 commitを作る', async () => {
    const github = new FakeRepositoryGitHub();
    const service = new RepositoryService(
      serverTestConfig(),
      github,
      new FixedClock(Date.UTC(2026, 7, 6, 0, 0, 0)),
    );
    const bundle = validatedBundle();

    const prepared = await service.prepare(bundle, 'session-hash');
    expect(github.blobs).toBe(0);
    expect(github.commits).toBe(0);
    expect(prepared.diff).toContain('+ content/characters/sample-unit.json');

    const result = await service.createPullRequest(prepared.id, bundle, 'session-hash');
    expect(github.blobs).toBe(1);
    expect(github.trees).toBe(1);
    expect(github.commits).toBe(1);
    expect(github.branches).toEqual([prepared.branch]);
    expect(github.branches[0]).not.toBe('master');
    expect(github.pullRequests).toBe(1);
    expect(result.number).toBe(42);

    const retry = await service.createPullRequest(prepared.id, bundle, 'session-hash');
    expect(retry).toEqual(result);
    expect(github.commits).toBe(1);
    expect(github.pullRequests).toBe(1);
  });

  it('sessionまたはbundleがprepare時と違えば拒否する', async () => {
    const github = new FakeRepositoryGitHub();
    const service = new RepositoryService(serverTestConfig(), github);
    const bundle = validatedBundle();
    const prepared = await service.prepare(bundle, 'first-session');

    await expect(service.createPullRequest(prepared.id, bundle, 'other-session')).rejects.toBeInstanceOf(HttpError);
    await expect(service.createPullRequest(prepared.id, { ...bundle, digest: 'f'.repeat(64) }, 'first-session'))
      .rejects.toMatchObject({ code: 'preparation_mismatch' });
  });

  it('base SHAがprepare後に変わればGitHubへ書き込む前に停止する', async () => {
    const github = new FakeRepositoryGitHub();
    const service = new RepositoryService(serverTestConfig(), github);
    const bundle = validatedBundle();
    const prepared = await service.prepare(bundle, 'session-hash');
    github.baseSha = '9'.repeat(40);

    await expect(service.createPullRequest(prepared.id, bundle, 'session-hash'))
      .rejects.toMatchObject({ code: 'base_sha_conflict' });
    expect(github.blobs).toBe(0);
    expect(github.commits).toBe(0);
    expect(github.branches).toHaveLength(0);
  });

  it('GitHubClientは固定repositoryへPOSTでbranchを作り、ref更新PATCHを使わない', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const config = serverTestConfig({
      GITHUB_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      GITHUB_API_URL: 'https://api.github.invalid',
    });
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes('/access_tokens')) {
        return Response.json({ token: 'installation-token', expires_at: '2026-08-06T01:00:00.000Z' });
      }
      return Response.json({ ref: 'refs/heads/studio/add-character-sample-unit' }, { status: 201 });
    };
    const client = new GitHubClient(
      config,
      fetchMock,
      new FixedClock(Date.UTC(2026, 7, 6, 0, 0, 0)),
    );

    await client.createBranch('studio/add-character-sample-unit', 'e'.repeat(40));
    const branchRequest = requests[1];
    expect(branchRequest.url).toBe(
      'https://api.github.invalid/repos/target-owner/target-repository/git/refs',
    );
    expect(branchRequest.init?.method).toBe('POST');
    expect(JSON.parse(String(branchRequest.init?.body))).toEqual({
      ref: 'refs/heads/studio/add-character-sample-unit',
      sha: 'e'.repeat(40),
    });
    expect(requests.some(({ init }) => init?.method === 'PATCH')).toBe(false);
    expect(JSON.stringify(requests)).not.toContain('test-private-key');
  });
});
