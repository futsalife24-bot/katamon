import { describe, expect, it } from 'vitest';

import { MockRepositoryGateway } from '../../src/github/mock-gateway';
import { sampleBundle } from './test-bundle';

describe('MockRepositoryGateway', () => {
  it('uses generated artifacts for one mock commit and PR', async () => {
    const bundle = await sampleBundle();
    const gateway = new MockRepositoryGateway();
    const prepared = await gateway.prepare(bundle);
    expect(prepared.files).toEqual(bundle.files);
    expect(prepared.files).not.toBe(bundle.files);
    expect(prepared.branch).toBe('studio/add-character-sample-unit-20260806000000');
    expect(prepared.diff).toContain('content/characters/sample-unit.json');
    const pullRequest = await gateway.createPullRequest(prepared, bundle);
    expect(pullRequest.checks).toBe('success');
    expect(await gateway.getChecks(prepared.commitSha)).toBe('success');
    expect(await gateway.getDeployment(prepared.commitSha)).toBe('published');
  });

  it('reproduces offline and conflict recovery states', async () => {
    const bundle = await sampleBundle();
    const gateway = new MockRepositoryGateway();
    await expect(gateway.prepare(bundle, 'network-offline')).rejects.toMatchObject({
      code: 'NETWORK_OFFLINE', retryable: true,
    });
    await expect(gateway.prepare(bundle, 'conflict')).rejects.toMatchObject({
      code: 'CONFLICT', retryable: true,
    });
  });

  it('reproduces a failed test result without replacing artifacts', async () => {
    const bundle = await sampleBundle();
    const gateway = new MockRepositoryGateway();
    const prepared = await gateway.prepare(bundle, 'tests-failed');
    expect(prepared.testStatus).toBe('failure');
    const pullRequest = await gateway.createPullRequest(prepared, bundle, 'tests-failed');
    expect(pullRequest.checks).toBe('failure');
    expect(await gateway.getChecks(prepared.commitSha)).toBe('failure');
  });

  it('rejects a modified generated file', async () => {
    const bundle = await sampleBundle();
    bundle.files[0] = { ...bundle.files[0], byteLength: bundle.files[0].byteLength + 1 };
    await expect(new MockRepositoryGateway().prepare(bundle)).rejects.toMatchObject({ code: 'INVALID_BUNDLE' });
  });

  it('rejects public metadata that no longer matches the canonical artifact', async () => {
    const bundle = await sampleBundle();
    bundle.character = { ...bundle.character, displayName: '別のサンプルキャラクター' };
    await expect(new MockRepositoryGateway().prepare(bundle)).rejects.toMatchObject({ code: 'INVALID_BUNDLE' });
  });
});
