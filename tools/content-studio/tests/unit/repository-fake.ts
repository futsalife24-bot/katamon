import { createHash } from 'node:crypto';
import { trustedFile } from '../../server/snapshot';
import type { BuildState, GitTreeEntry } from '../../server/types';
const sha = (v: unknown) => createHash('sha1').update(JSON.stringify(v)).digest('hex');
export class FixtureRepository {
  baseSha = 'a'.repeat(40);
  tree: GitTreeEntry[] = [];
  blobData = new Map<string, Buffer>();
  treeData = new Map<string, GitTreeEntry[]>();
  commitData = new Map<string, { sha: string; treeSha: string; parents: string[]; message: string }>();
  refs = new Map<string, string>();
  prs = new Map<number, { branch: string; head: string; merged: boolean; base: string }>();
  branches: string[] = []; blobs = 0; trees = 0; commits = 0; pullRequests = 0; merges = 0;
  checks: BuildState = 'queued'; safe = true; fault: 'branch' | 'pr' | 'merge' | null = null;
  async getBaseSha() { return this.baseSha; }
  async getCommit(commitSha: string) {
    if (this.commitData.has(commitSha)) return this.commitData.get(commitSha)!;
    const treeSha = sha(this.tree); this.treeData.set(treeSha, structuredClone(this.tree));
    const commit = { sha: commitSha, treeSha, parents: [] as string[], message: 'base' }; this.commitData.set(commitSha, commit); return commit;
  }
  async getTree(treeSha: string) { return structuredClone(this.treeData.get(treeSha) ?? this.tree); }
  async getBlob(blobSha: string) { const bytes = this.blobData.get(blobSha); if (!bytes) throw new Error('missing blob'); return bytes; }
  async createBlob(bytes: Buffer) { this.blobs++; const file = trustedFile('', '', bytes); this.blobData.set(file.gitBlobSha, bytes); return file.gitBlobSha; }
  async createTree(base: string, entries: Array<{path: string; sha: string}>) {
    this.trees++;
    const tree = new Map((this.treeData.get(base) ?? this.tree).map(e => [e.path,e]));
    for (const e of entries) tree.set(e.path, { ...e, type: 'blob', mode: '100644' });
    const data = [...tree.values()]; const id = sha(data); this.treeData.set(id, data); return id;
  }
  async createCommit(message: string, treeSha: string, parent: string) {
    this.commits++; const id = sha([message, treeSha, parent, this.commits]);
    this.commitData.set(id, { sha: id, treeSha, parents: [parent], message }); return id;
  }
  async createBranch(branch: string, commit: string) {
    if (this.refs.has(branch)) throw new Error('branch exists');
    this.refs.set(branch, commit); this.branches.push(branch);
    if (this.fault === 'branch') { this.fault = null; throw new Error('lost branch response'); }
  }
  async getBranchSha(branch: string) { return this.refs.get(branch) ?? null; }
  async createPullRequest(input: { branch: string; title: string; body: string }) {
    if ([...this.prs.values()].some(p => p.branch === input.branch)) throw new Error('PR exists');
    const number = ++this.pullRequests + 41;
    const head = this.refs.get(input.branch)!;
    this.prs.set(number, { branch: input.branch, head, base: this.commitData.get(head)!.parents[0], merged: false });
    if (this.fault === 'pr') { this.fault = null; throw new Error('lost PR response'); }
    return { number, url: `https://github.invalid/pull/${number}` };
  }
  async findPullRequest(branch: string) {
    const entry = [...this.prs].find(([,p]) => p.branch === branch);
    return entry ? { number: entry[0], url: `https://github.invalid/pull/${entry[0]}` } : null;
  }
  async getPullRequest(number: number) {
    const p = this.prs.get(number); if (!p) throw new Error('PR missing');
    return { number, url: `https://github.invalid/pull/${number}`, state: p.merged ? 'closed' as const : 'open' as const,
      baseRef: 'master', headRef: p.branch, headSha: this.refs.get(p.branch) ?? p.head,
      merged: p.merged, baseRepo: 'target-owner/target-repository', headRepo: 'target-owner/target-repository', baseSha: this.baseSha,
      mergeCommitSha: p.merged ? 'f'.repeat(40) : null };
  }
  async mergePullRequest(number: number, expected: string) {
    const p = this.prs.get(number)!;
    if (this.refs.get(p.branch) !== expected) throw new Error('head conflict');
    if (!p.merged) { p.merged = true; this.merges++; }
    if (this.fault === 'merge') { this.fault = null; throw new Error('lost merge response'); }
    return { merged: true as const };
  }
  async getChecks(): Promise<BuildState> { return this.checks; }
  deploymentRefs: string[] = [];
  async getDeployment(ref: string) { this.deploymentRefs.push(ref); return 'pending' as const; }
  async getMergeProtection() { return { safe: this.safe, requirements: [] }; }
  advanceTo(head: string) { this.baseSha = head; this.tree = structuredClone(this.treeData.get(this.commitData.get(head)!.treeSha)!); }
}
