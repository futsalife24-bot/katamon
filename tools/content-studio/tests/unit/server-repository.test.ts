import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { GitHubClient } from '../../server/github-api.js';
import { RepositoryService } from '../../server/repository-service.js';
import { HttpError } from '../../server/security.js';
import { FixtureRepository } from './repository-fake';
import type { Clock } from '../../server/types.js';
import { serverTestConfig, validatedBundle } from './server-fixtures.js';

class FixedClock implements Clock {
  constructor(private readonly value: number) {}
  now(): number {
    return this.value;
  }
}

class FakeRepositoryGitHub extends FixtureRepository {}

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
    expect(github.blobs).toBe(bundle.files.length + 2);
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

  it('CI成功前は止め、成功後だけ準備済みPRをマージする', async () => {
    const github = new FakeRepositoryGitHub();
    const service = new RepositoryService(
      serverTestConfig(),
      github,
      new FixedClock(Date.UTC(2026, 7, 6, 0, 0, 0)),
    );
    const bundle = validatedBundle();
    const prepared = await service.prepare(bundle, 'session-hash');
    const pullRequest = await service.createPullRequest(prepared.id, bundle, 'session-hash');

    github.checks = 'failure';
    await expect(service.mergePullRequest(prepared.id, pullRequest.number, pullRequest.commitSha, 'session-hash'))
      .rejects.toMatchObject({ code: 'checks_not_successful' });
    expect(github.merges).toBe(0);

    github.checks = 'success';
    const merged = await service.mergePullRequest(
      prepared.id,
      pullRequest.number,
      pullRequest.commitSha,
      'session-hash',
    );
    expect(merged.merged).toBe(true);
    expect(merged.checks).toBe('success');
    expect(github.merges).toBe(1);
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
