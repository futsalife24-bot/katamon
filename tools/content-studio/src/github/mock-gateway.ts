import type {
  ArtifactBundle,
  ArtifactFile,
  MockScenario,
  PreparedChange,
  PullRequestResult,
  RepositoryGateway,
  RepositoryStatus,
} from '../domain/types';
import { characterFormSchema } from '../domain/schemas';
import { isAllowedGeneratedPath } from '../domain/validation';
import { canonicalCharacterRecordSchema } from '../generation/catalog';
import { sha256Blob, sha256Text } from '../generation/hash';
import { stableStringify } from '../generation/stable';

export type MockRepositoryErrorCode = 'NETWORK_OFFLINE' | 'TESTS_FAILED' | 'CHECKS_FAILED' | 'CONFLICT' | 'INVALID_BUNDLE' | 'NOT_PREPARED' | 'PR_MISMATCH';

export class MockRepositoryError extends Error {
  readonly code: MockRepositoryErrorCode;
  readonly retryable: boolean;

  constructor(code: MockRepositoryErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'MockRepositoryError';
    this.code = code;
    this.retryable = retryable;
  }
}

export interface MockRepositoryGatewayOptions {
  scenario?: MockScenario;
  latencyMs?: number;
}

interface PreparedRecord {
  bundleId: string;
  prepared: PreparedChange;
  scenario: MockScenario;
}

const MOCK_BASE_SHA = '0000000000000000000000000000000000000000';

async function verifyFile(file: ArtifactFile): Promise<void> {
  if (!isAllowedGeneratedPath(file.path)) {
    throw new MockRepositoryError('INVALID_BUNDLE', '許可されていない変更パスです');
  }
  if (file.text === undefined && file.blob === undefined) {
    throw new MockRepositoryError('INVALID_BUNDLE', '生成ファイルの内容がありません');
  }
  const actualSize = file.text !== undefined ? new TextEncoder().encode(file.text).byteLength : file.blob!.size;
  const actualHash = file.text !== undefined ? await sha256Text(file.text) : await sha256Blob(file.blob!);
  if (actualSize !== file.byteLength || actualHash !== file.sha256) {
    throw new MockRepositoryError('INVALID_BUNDLE', '生成ファイルの検証に失敗しました');
  }
}

async function verifyBundle(bundle: ArtifactBundle): Promise<void> {
  if (!characterFormSchema.safeParse(bundle.character).success || bundle.files.length === 0) {
    throw new MockRepositoryError('INVALID_BUNDLE', '生成物のキャラクターデータが正しくありません');
  }
  if (bundle.issues.some(({ severity }) => severity === 'error')) {
    throw new MockRepositoryError('INVALID_BUNDLE', '検証エラーのある生成物は反映できません');
  }

  const seen = new Set<string>();
  for (const file of bundle.files) {
    if (seen.has(file.path)) throw new MockRepositoryError('INVALID_BUNDLE', '変更ファイルが重複しています');
    seen.add(file.path);
    await verifyFile(file);
  }
  const expectedBundleId = await sha256Text(stableStringify(
    bundle.files.map(({ path, sha256, byteLength }) => ({ path, sha256, byteLength })),
  ));
  if (expectedBundleId !== bundle.bundleId) {
    throw new MockRepositoryError('INVALID_BUNDLE', '生成物IDの整合性を確認できません');
  }

  const characterFiles = bundle.files.filter(({ kind }) => kind === 'character-data');
  if (characterFiles.length !== 1 || characterFiles[0].text === undefined) {
    throw new MockRepositoryError('INVALID_BUNDLE', '正規キャラクターデータが1件ではありません');
  }
  let canonical: unknown;
  try {
    canonical = canonicalCharacterRecordSchema.parse(JSON.parse(characterFiles[0].text));
  } catch {
    throw new MockRepositoryError('INVALID_BUNDLE', '正規キャラクターデータを読み込めません');
  }
  const record = canonical as {
    character: unknown;
    spriteMetadata: unknown;
    generatorVersion: string;
  };
  if (
    stableStringify(record.character) !== stableStringify(bundle.character) ||
    stableStringify(record.spriteMetadata) !== stableStringify(bundle.spriteMetadata) ||
    record.generatorVersion !== bundle.generatorVersion
  ) {
    throw new MockRepositoryError('INVALID_BUNDLE', '生成物と公開情報が一致しません');
  }
}

function timestampForBranch(isoDate: string): string {
  return isoDate.replace(/[-:.TZ]/gu, '').slice(0, 14);
}

function renderDiff(files: readonly ArtifactFile[]): string {
  return files.map((file) => {
    const header = `diff --git a/${file.path} b/${file.path}\nnew file mode 100644\n--- /dev/null\n+++ b/${file.path}\n`;
    if (file.text === undefined) return `${header}Binary file (${file.byteLength} bytes, sha256:${file.sha256})\n`;
    const added = file.text.split('\n').map((line) => `+${line}`).join('\n');
    return `${header}@@ -0,0 +1 @@\n${added}\n`;
  }).join('\n');
}

/** In-memory GitHub substitute that still validates and hashes real artifacts. */
export class MockRepositoryGateway implements RepositoryGateway {
  private scenario: MockScenario;
  private connected = true;
  private readonly latencyMs: number;
  private readonly prepared = new Map<string, PreparedRecord>();
  private readonly checks = new Map<string, RepositoryStatus['build']>();
  private readonly deployments = new Map<string, RepositoryStatus['deployment']>();

  constructor(options: MockRepositoryGatewayOptions = {}) {
    this.scenario = options.scenario ?? 'success';
    this.latencyMs = Math.max(0, Math.min(options.latencyMs ?? 0, 2_000));
  }

  setScenario(scenario: MockScenario): void {
    this.scenario = scenario;
    this.connected = scenario !== 'network-offline';
  }

  async getStatus(): Promise<RepositoryStatus> {
    await this.wait();
    if (this.scenario === 'network-offline') {
      return {
        mode: 'mock', connected: false, user: '管理者', build: 'idle', deployment: 'unknown',
        baseSha: MOCK_BASE_SHA, message: 'モック通信を切断しています。下書きは端末内へ保持されます。',
      };
    }
    return {
      mode: 'mock', connected: this.connected, user: this.connected ? '管理者' : null,
      build: this.scenario === 'tests-failed' ? 'failure' : 'success',
      deployment: this.scenario === 'tests-failed' ? 'failure' : 'published',
      baseSha: MOCK_BASE_SHA,
      message: this.connected ? 'モックモードで接続しています。' : 'ログアウトしています。',
    };
  }

  async prepare(bundle: ArtifactBundle, scenario = this.scenario): Promise<PreparedChange> {
    await this.wait();
    this.assertOnline(scenario);
    if (scenario === 'conflict' || (bundle.expectedBaseSha && bundle.expectedBaseSha !== MOCK_BASE_SHA)) {
      throw new MockRepositoryError('CONFLICT', 'ベースブランチが更新されています。再検証してください。', true);
    }
    await verifyBundle(bundle);

    const commitInput = stableStringify({
      bundleId: bundle.bundleId,
      files: bundle.files.map(({ path, sha256, byteLength }) => ({ path, sha256, byteLength })),
    });
    const commitSha = (await sha256Text(commitInput)).slice(0, 40);
    const id = `mock-${commitSha.slice(0, 16)}`;
    const prepared: PreparedChange = {
      id,
      branch: `studio/add-character-${bundle.character.slug}-${timestampForBranch(bundle.createdAt)}`,
      commitSha,
      files: bundle.files.map((file) => ({ ...file })),
      testStatus: scenario === 'tests-failed' ? 'failure' : 'success',
      diff: renderDiff(bundle.files),
    };
    this.prepared.set(id, {
      bundleId: bundle.bundleId,
      prepared: { ...prepared, files: prepared.files.map((file) => ({ ...file })) },
      scenario,
    });
    this.checks.set(commitSha, prepared.testStatus);
    this.deployments.set(commitSha, prepared.testStatus === 'success' ? 'pending' : 'failure');
    return prepared;
  }

  async createPullRequest(
    prepared: PreparedChange,
    bundle: ArtifactBundle,
    scenario = this.scenario,
  ): Promise<PullRequestResult> {
    await this.wait();
    this.assertOnline(scenario);
    if (scenario === 'conflict') throw new MockRepositoryError('CONFLICT', '同時編集との競合を検出しました。', true);
    const record = this.prepared.get(prepared.id);
    if (!record || record.bundleId !== bundle.bundleId || record.prepared.commitSha !== prepared.commitSha) {
      throw new MockRepositoryError('NOT_PREPARED', '公開準備をもう一度実行してください');
    }
    await verifyBundle(bundle);
    const failed = scenario === 'tests-failed' || prepared.testStatus === 'failure';
    const number = Number.parseInt(prepared.commitSha.slice(0, 6), 16) % 9_000 + 1_000;
    const checks = failed ? 'failure' : 'success';
    const deployment = failed ? 'failure' : 'published';
    this.checks.set(prepared.commitSha, checks);
    this.deployments.set(prepared.commitSha, deployment);
    return {
      number,
      url: `https://example.invalid/content-studio/pull/${number}`,
      branch: prepared.branch,
      commitSha: prepared.commitSha,
      checks,
      deployment,
    };
  }

  async mergePullRequest(
    prepared: PreparedChange,
    result: PullRequestResult,
    scenario = this.scenario,
  ): Promise<PullRequestResult> {
    await this.wait();
    this.assertOnline(scenario);
    if (scenario === 'conflict') throw new MockRepositoryError('CONFLICT', 'PRの競合を検出したためマージしませんでした。', true);
    if (scenario === 'tests-failed' || this.checks.get(prepared.commitSha) !== 'success') {
      throw new MockRepositoryError('CHECKS_FAILED', 'CIが成功していないためマージしませんでした。', true);
    }
    if (result.commitSha !== prepared.commitSha || result.branch !== prepared.branch) {
      throw new MockRepositoryError('PR_MISMATCH', '準備した変更とPRが一致しません。', true);
    }
    return { ...result, merged: true, mergedAt: new Date().toISOString(), deployment: 'published' };
  }

  async getChecks(ref: string): Promise<RepositoryStatus['build']> {
    await this.wait();
    this.assertOnline(this.scenario);
    return this.checks.get(ref) ?? 'idle';
  }

  async getDeployment(ref: string): Promise<RepositoryStatus['deployment']> {
    await this.wait();
    this.assertOnline(this.scenario);
    return this.deployments.get(ref) ?? 'unknown';
  }

  async logout(): Promise<void> {
    await this.wait();
    this.connected = false;
  }

  private assertOnline(scenario: MockScenario) {
    if (scenario === 'network-offline') {
      throw new MockRepositoryError('NETWORK_OFFLINE', '通信が切断されています。接続後に再試行してください。', true);
    }
    if (!this.connected) throw new MockRepositoryError('NETWORK_OFFLINE', '再ログインしてください。', true);
  }

  private async wait(): Promise<void> {
    if (this.latencyMs === 0) return;
    await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
  }
}
