import { canonicalCharacterRecordSchema } from '../src/generation/catalog.js';
import { parseBoundedJson } from '../src/domain/bounded-json.js';
import { trustedFile } from './snapshot.js';
import type { PublishedRevision } from '../src/domain/editing-checkpoint.js';
import { createHmac, randomBytes } from 'node:crypto';
import type { GitHubClient } from './github-api.js';
import { HttpError } from './security.js';
import { reconstructSnapshot, fileDigest } from './snapshot.js';
import type { BuildState, Clock, DeploymentState, GitTreeEntry, ServerConfig, ValidatedBundle, ValidatedFile } from './types.js';
import { systemClock } from './types.js';

type RepositoryGitHub = Pick<GitHubClient, 'getBaseSha' | 'getCommit' | 'getTree' | 'getBlob' | 'createBlob' | 'createTree' | 'createCommit' | 'createBranch' | 'getBranchSha' | 'createPullRequest' | 'findPullRequest' | 'getPullRequest' | 'mergePullRequest' | 'getChecks' | 'getDeployment' | 'getMergeProtection'>;
export interface PullRequestServiceResult {
  number: number; url: string; branch: string; commitSha: string; checks: BuildState;
  deployment: DeploymentState; merged?: boolean; mergedAt?: string; mergeCommitSha?: string;
}
export interface PrepareResult {
  operationDigest: string;
  latestBaseSha: string;
  predecessor?: {number:number;url:string};
  id: string; branch: string; baseSha: string; diff: string;
  changedFiles: Array<{ path: string; mimeType: string; byteLength: number; sha256: string; text?: string }>;
  recovered?: PullRequestServiceResult;
}
interface Inspection { baseSha: string; treeSha: string; entries: GitTreeEntry[]; files: ValidatedFile[]; changed: ValidatedFile[]; }
interface Preparation { id: string; actor: string; digest: string; branch: string; baseSha: string; expiresAt: number; snapshotDigest: string; bundle: ValidatedBundle; head?: string; }
const fail = (code: string, message: string): never => { throw new HttpError(409, code, message); };
export class RepositoryService {
  private readonly preparations = new Map<string, Preparation>();
  private readonly inFlight = new Map<string, Promise<PullRequestServiceResult>>();
  constructor(private readonly config: ServerConfig, private readonly github: RepositoryGitHub, private readonly clock: Clock = systemClock) {}
  async getStatus() {
    const baseSha = await this.github.getBaseSha();
    const [checks, deployment] = await Promise.allSettled([this.github.getChecks(baseSha), this.github.getDeployment(baseSha)]);
    return { baseSha, build: checks.status === 'fulfilled' ? checks.value : 'idle' as BuildState, deployment: deployment.status === 'fulfilled' ? deployment.value : 'unknown' as DeploymentState };
  }
  private publishedReads = 0;
  async listPublishedCharacters() {
    if(this.publishedReads>=2)throw new HttpError(429,'published_read_busy','公開データの読込中です。少し待って再試行してください。');
    this.publishedReads++;
    try {
    const baseSha=await this.github.getBaseSha(), commit=await this.github.getCommit(baseSha);
    if(commit.sha!==baseSha)fail('snapshot_invalid','基準commitが一致しません。');
    const tree=await this.github.getTree(commit.treeSha);
    const entries=tree.filter(e=>e.path.startsWith('content/characters/') && e.path.endsWith('.json'));
    if(entries.length>500)fail('snapshot_limit','公開キャラ数が上限を超えています。');
    const records=[];let total=0, failed=0;
    for(const e of entries) {
      try {
      if(e.type!=='blob'||e.mode!=='100644'||(e.size??0)>this.config.maxFileBytes)fail('snapshot_invalid','公開正本を安全に読めません。');
      const bytes=await this.github.getBlob(e.sha);total+=bytes.length;
      if(bytes.length>this.config.maxFileBytes||total>this.config.maxTotalFileBytes||trustedFile(e.path,'application/json',bytes).gitBlobSha!==e.sha)fail('snapshot_invalid','公開正本の容量・hashが不正です。');
      const record=canonicalCharacterRecordSchema.parse(parseBoundedJson(bytes.toString('utf8')));
      if(e.path!==`content/characters/${record.character.slug}.json`)fail('snapshot_invalid','公開正本のslugが一致しません。');
      records.push(record);
      }catch{failed++;}
      if(total>this.config.maxTotalFileBytes)fail('snapshot_limit','公開一覧の容量が上限を超えています。');
    }
    return {baseSha,records,failed};
    }finally{this.publishedReads--;}
  }
  async readPublishedCharacter(slug:string, actor:string) {
    if(!/^[a-z][a-z0-9-]{0,23}$/.test(slug))fail('published_slug_invalid','公開対象のslugが不正です。');
    if(this.publishedReads>=2)throw new HttpError(429,'published_read_busy','公開データの読込中です。少し待って再試行してください。');
    this.publishedReads++;
    try {
      const baseSha=await this.github.getBaseSha(), commit=await this.github.getCommit(baseSha), tree=await this.github.getTree(commit.treeSha);
      if(commit.sha!==baseSha)fail('snapshot_invalid','基準commitが一致しません。');
      const path=`content/characters/${slug}.json`, entry=tree.find(e=>e.path===path);
      if(!entry)throw new HttpError(404,'published_missing','公開正本が見つかりません。');
      const files: ValidatedFile[]=[];let total=0;
      const read=async(path:string)=>{
        const e=tree.find(e=>e.path===path);
        if(!e||e.type!=='blob'||e.mode!=='100644'||(e.size??0)>this.config.maxFileBytes)fail('snapshot_invalid','公開参照が不正または容量超過です。');
        const bytes=await this.github.getBlob(e!.sha);total+=bytes.length;
        if(bytes.length>this.config.maxFileBytes||total>this.config.maxTotalFileBytes)fail('snapshot_limit','公開生成物の容量が上限を超えています。');
        const mime=path.endsWith('.json')?'application/json':path.endsWith('.webp')?'image/webp':path.endsWith('.jpg')?'image/jpeg':'image/png';
        const f=trustedFile(path,mime,bytes);if(f.gitBlobSha!==e!.sha)fail('snapshot_invalid','公開参照のhashが一致しません。');files.push(f);return f;
      };
      const canonical=await read(path), record=canonicalCharacterRecordSchema.parse(parseBoundedJson(canonical.bytes.toString('utf8')));
      if(record.character.slug!==slug)fail('snapshot_invalid','公開正本のslugが一致しません。');
      const paths=new Set<string>();
      for(const [key,value] of Object.entries(record.assets))if(key!=='directory'&&value){if(typeof value==='string')paths.add(value);else Object.values(value).forEach(p=>paths.add(p));}
      if(paths.size+1>this.config.maxFiles)fail('snapshot_limit','公開ファイル数が上限を超えています。');
      for(const asset of paths)await read(asset);
      const revision:PublishedRevision={mode:'server',repository:`${this.config.githubOwner}/${this.config.githubRepo}`,slug,baseSha,canonicalBlobSha:entry.sha,attestation:this.sign('published-edit-v1',actor,slug,baseSha,entry.sha)};
      await reconstructSnapshot({bundleId:'published-read',generatorVersion:record.generatorVersion,character:record.character,files,prBody:'Read published character',digest:'read'},tree,sha=>this.github.getBlob(sha),this.config);
      const response={revision,record,files:files.map(f=>({path:f.path,mimeType:f.mimeType,byteLength:f.bytes.length,sha256:f.sha256,gitBlobSha:f.gitBlobSha,contentBase64:f.bytes.toString('base64')}))};
      if(Buffer.byteLength(JSON.stringify(response))>this.config.maxRequestBytes)fail('snapshot_limit','公開データの転送容量が上限を超えています。');
      return response;
    } finally {this.publishedReads--;}
  }
  private validateSourceRevision(bundle:ValidatedBundle, entries:GitTreeEntry[], actor:string) {
    const path=`content/characters/${bundle.character.slug}.json`, before=entries.find(e=>e.path===path), target=bundle.files.find(f=>f.path===path);
    const revision=bundle.sourceRevision;
    if(!revision) {if(before && before.sha!==target?.gitBlobSha)fail('published_revision_required','公開元revisionを確認できません。作業を保持して公開一覧から最新版を別の下書きへ読み込んでください。');return;}
    if(revision.mode!=='server'||revision.repository!==`${this.config.githubOwner}/${this.config.githubRepo}`||revision.slug!==bundle.character.slug||revision.attestation!==this.sign('published-edit-v1',actor,revision.slug,revision.baseSha,revision.canonicalBlobSha))throw new HttpError(403,'published_revision_invalid','公開元の本人・repository・revisionを確認できません。');
    if(before?.sha!==revision.canonicalBlobSha)fail('published_target_conflict','同じキャラクターが別の操作で更新されています。編集中の内容を保持して停止しました。公開最新版は別の下書きへ読み込めます。');
  }
  private sign(...values: string[]): string {
    return createHmac('sha256', this.config.sessionSecret).update(JSON.stringify([this.config.githubOwner, this.config.githubRepo, this.config.githubBaseBranch, ...values])).digest('hex');
  }
  private branch(bundle: ValidatedBundle, actor: string): string {
    return `studio/add-character-${bundle.character.slug}-${this.sign(actor, bundle.digest).slice(0,40)}`;
  }
  private message(p: Preparation, treeSha: string): string {
    return `content-studio: update ${p.bundle.character.slug}\n\nStudio-Attestation: ${this.sign(p.actor, p.digest, p.branch, p.baseSha, treeSha)}`;
  }
  private async inspect(bundle: ValidatedBundle, baseSha: string): Promise<Inspection> {
    const commit = await this.github.getCommit(baseSha);
    if (commit.sha !== baseSha) fail('snapshot_invalid', '基準commitを照合できません。');
    const entries = await this.github.getTree(commit.treeSha);
    const files = await reconstructSnapshot(bundle, entries, sha => this.github.getBlob(sha), this.config);
    const changed = files.filter(f => entries.find(e => e.path === f.path)?.sha !== f.gitBlobSha);
    return { baseSha, treeSha: commit.treeSha, entries, files, changed };
  }
  private async assertHead(p: Preparation, head: string, inspection: Inspection): Promise<void> {
    const commit = await this.github.getCommit(head);
    if (commit.sha !== head || commit.parents.length !== 1 || commit.parents[0] !== p.baseSha || commit.message !== this.message(p, commit.treeSha)) fail('head_changed', '公開commitの本人・基準・内容が一致しません。');
    const actual = await this.github.getTree(commit.treeSha);
    const expected = new Map(inspection.entries.filter(e => e.type !== 'tree').map(e => [e.path, [e.mode, e.type, e.sha]]));
    for (const f of inspection.changed) expected.set(f.path, ['100644', 'blob', f.gitBlobSha]);
    const contents = actual.filter(e => e.type !== 'tree');
    if (contents.length !== expected.size || contents.some(e => JSON.stringify(expected.get(e.path)) !== JSON.stringify([e.mode, e.type, e.sha]))) fail('head_changed', '差分確認後に公開内容が変わっています。');
    if (p.head && p.head !== head) fail('head_changed', '確認済みのhead SHAが変わっています。');
    p.head = head;
  }
  private validatePr(p: Preparation, pr: Awaited<ReturnType<RepositoryGitHub['getPullRequest']>>): void {
    const repo = `${this.config.githubOwner}/${this.config.githubRepo}`;
    if (pr.baseRepo !== repo || pr.headRepo !== repo || pr.baseRef !== this.config.githubBaseBranch || pr.headRef !== p.branch || pr.headSha !== p.head) fail('pull_request_changed', 'PRのrepository・branch・headが一致しません。');
    if (!pr.merged && pr.state !== 'open') fail('pull_request_not_open', '閉じられたPRは再作成せず、GitHubで確認してください。');
  }
  private async result(p: Preparation, number: number): Promise<PullRequestServiceResult> {
    const pr = await this.github.getPullRequest(number);
    this.validatePr(p, pr);
    const checks = await this.github.getChecks(pr.headSha).catch(() => 'queued' as BuildState);
    const deployment = pr.merged && pr.mergeCommitSha ? await this.github.getDeployment(pr.mergeCommitSha).catch(() => 'unknown' as DeploymentState) : 'pending';
    return { number, url: pr.url, branch: p.branch, commitSha: pr.headSha, checks, deployment, merged: pr.merged, ...(pr.merged && pr.mergeCommitSha ? { mergeCommitSha: pr.mergeCommitSha } : {}) };
  }
  async prepare(bundle: ValidatedBundle, actor: string): Promise<PrepareResult> {
    for (const [id,p] of this.preparations) if (p.expiresAt <= this.clock.now()) this.preparations.delete(id);
    const branch = this.branch(bundle, actor);
    if (bundle.recoveryBranch && bundle.recoveryBranch !== branch) throw new HttpError(403, 'recovery_actor_mismatch', '復旧対象の本人・repository・内容が一致しません。');
    const existingPr = await this.github.findPullRequest(branch);
    const pr = existingPr ? await this.github.getPullRequest(existingPr.number) : null;
    const existingHead = await this.github.getBranchSha(branch) ?? pr?.headSha;
    let predecessor: {number:number;url:string}|undefined;
    const revalidation=bundle.revalidation;
    if(revalidation) {
      const previousBundle={...bundle,digest:revalidation.digest};
      if(this.branch(previousBundle,actor)!==revalidation.branch) fail('revalidation_identity','再検証元の本人・repository・操作が一致しません。');
      const prior:Preparation={id:'prior',actor,digest:revalidation.digest,branch:revalidation.branch,baseSha:revalidation.baseSha,head:revalidation.headSha,bundle:previousBundle,expiresAt:0,snapshotDigest:''};
      const previousInspection=await this.inspect(bundle,revalidation.baseSha);
      await this.assertHead(prior,revalidation.headSha,previousInspection);
      predecessor=await this.github.findPullRequest(revalidation.branch)??undefined;
      if(!predecessor)fail('revalidation_missing_pr','再検証元のPRを確認できません。');
      const previousPr=await this.github.getPullRequest(predecessor!.number);
      this.validatePr(prior,previousPr);
      if(previousPr.merged)fail('revalidation_already_merged','元のPRはmerge済みです。公開済みデータから編集してください。');
      const nextInspection=await this.inspect(bundle,revalidation.targetBaseSha);
      const targetPath='content/characters/'+bundle.character.slug+'.json';
      if(previousInspection.entries.find(e=>e.path===targetPath)?.sha!==nextInspection.entries.find(e=>e.path===targetPath)?.sha)fail('target_changed','対象キャラクターが最新masterで変更されています。競合を確認してください。元PRと生成物は保持しています。');
    }
    let baseSha: string;
    if (existingHead) {
      const commit = await this.github.getCommit(existingHead);
      if (commit.parents.length !== 1) fail('head_changed', '復旧対象の親commitが不正です。');
      baseSha = commit.parents[0];
      if(revalidation && baseSha!==revalidation.targetBaseSha)fail('revalidation_base','後継操作のbaseが一致しません。');
    } else {
      baseSha = await this.github.getBaseSha();
      if(revalidation && baseSha!==revalidation.targetBaseSha)fail('base_sha_conflict','最新baseが再度変わりました。旧PRを保持し、最新baseの再検証をやり直してください。');
      if (bundle.expectedBaseSha && baseSha !== bundle.expectedBaseSha) fail('base_sha_conflict', '基準ブランチが変わりました。再準備してください。');
    }
    const sourceCommit=await this.github.getCommit(baseSha);
    this.validateSourceRevision(bundle,await this.github.getTree(sourceCommit.treeSha),actor);
    const inspection = await this.inspect(bundle, baseSha);
    if (!inspection.changed.some(f=>!f.path.startsWith('generated/content-studio-')) && !existingHead) fail('no_changes', '公開する変更がありません。');
    const p: Preparation = { id: randomBytes(24).toString('base64url'), actor, digest: bundle.digest, branch, baseSha, expiresAt: this.clock.now() + this.config.preparationTtlMs, snapshotDigest: fileDigest(inspection.files), bundle };
    if (existingHead) await this.assertHead(p, existingHead, inspection);
    const recovered = pr ? await this.result(p, pr.number) : undefined;
    // Repeated recovery replaces the same operation's cached preparation, not its durable GitHub evidence.
    for (const [id, prior] of this.preparations) if (prior.actor === actor && prior.digest === bundle.digest) this.preparations.delete(id);
    if (this.preparations.size >= 16 || [...this.preparations.values()].reduce((n,p) => n + p.bundle.files.reduce((n,f) => n + f.bytes.length, 0), 0) + bundle.files.reduce((n,f) => n + f.bytes.length, 0) > 64 * 1024 * 1024) fail('preparation_limit', '公開準備が混み合っています。既存PRを確認してから再試行してください。');
    this.preparations.set(p.id, p);
    return { id: p.id, branch, baseSha, recovered, operationDigest:p.digest, latestBaseSha:await this.github.getBaseSha(), predecessor,
      diff: inspection.changed.map(f => `${inspection.entries.some(e => e.path === f.path) ? '~' : '+'} ${f.path} (${f.bytes.length} bytes, SHA256 ${f.sha256})`).join('\n'),
      changedFiles: inspection.changed.map(f => ({ path: f.path, mimeType: f.mimeType, byteLength: f.bytes.length, sha256: f.sha256, ...(!f.mimeType.startsWith('image/') ? { text: f.bytes.toString('utf8') } : {}) })),
    };
  }
  private prepared(id: string, actor: string): Preparation {
    const p = this.preparations.get(id);
    if (!p || p.expiresAt <= this.clock.now()) throw new HttpError(410, 'preparation_expired', '公開準備が失効しました。「既存PRを確認・再開」で復旧してください。生成物は保持されています。');
    if (p.actor !== actor) throw new HttpError(403, 'preparation_mismatch', '公開準備の本人と一致しません。');
    return p;
  }
  async createPullRequest(id: string, bundle: ValidatedBundle, actor: string): Promise<PullRequestServiceResult> {
    const p = this.prepared(id, actor);
    if (p.digest !== bundle.digest) throw new HttpError(403, 'preparation_mismatch', '差分確認後に内容が変わっています。再準備してください。');
    const pending = this.inFlight.get(p.branch);
    if (pending) { const result = await pending; p.head = result.commitSha; return result; }
    const promise = this.create(p);
    this.inFlight.set(p.branch, promise);
    try { return await promise; } finally { if (this.inFlight.get(p.branch) === promise) this.inFlight.delete(p.branch); }
  }
  private async create(p: Preparation): Promise<PullRequestServiceResult> {
    const inspection = await this.inspect(p.bundle, p.baseSha);
    this.validateSourceRevision(p.bundle,inspection.entries,p.actor);
    if (fileDigest(inspection.files) !== p.snapshotDigest) fail('snapshot_changed', '差分が変わりました。再準備してください。');
    let existingPr = await this.github.findPullRequest(p.branch);
    let head = await this.github.getBranchSha(p.branch);
    if (!head && existingPr) head = (await this.github.getPullRequest(existingPr.number)).headSha;
    if (!head) {
      await this.assertBase(p.baseSha);
      const entries = [];
      for (const f of inspection.changed) entries.push({ path: f.path, sha: await this.github.createBlob(f.bytes) });
      const treeSha = await this.github.createTree(inspection.treeSha, entries);
      const proposed = await this.github.createCommit(this.message(p, treeSha), treeSha, p.baseSha);
      await this.assertBase(p.baseSha);
      try { await this.github.createBranch(p.branch, proposed); }
      catch (error) { if (!await this.github.getBranchSha(p.branch)) throw error; }
      head = await this.github.getBranchSha(p.branch);
      if (!head) fail('branch_unconfirmed', 'branchの作成結果を確認できません。再試行してください。');
    }
    await this.assertHead(p, head!, inspection);
    existingPr = await this.github.findPullRequest(p.branch);
    if (!existingPr) {
      try { existingPr = await this.github.createPullRequest({ branch: p.branch, title: `Content Studio: ${p.bundle.character.displayName}`, body: p.bundle.prBody }); }
      catch (error) { existingPr = await this.github.findPullRequest(p.branch); if (!existingPr) throw error; }
    }
    return this.result(p, existingPr.number);
  }
  async mergePullRequest(id: string, number: number, expectedHead: string, actor: string): Promise<PullRequestServiceResult> {
    const p = this.prepared(id, actor);
    if (!Number.isSafeInteger(number) || number <= 0 || !/^[a-f0-9]{40}$/.test(expectedHead) || expectedHead !== p.head) fail('pull_request_mismatch', '確認済みのPR・headと一致しません。');
    const pr = await this.github.getPullRequest(number);
    this.validatePr(p, pr);
    await this.assertHead(p, expectedHead, await this.inspect(p.bundle, p.baseSha));
    if (pr.merged) return this.result(p, number);
    const protection = await this.github.getMergeProtection();
    if (!protection.safe) fail('protection_required', (protection.reason ? protection.reason + ' ' : '') + '自動マージ停止: masterの必須CI・最新base要件・管理者への適用を確認できません。PRは保持されています。管理者の保護設定が必要です。');
    if (await this.github.getChecks(expectedHead, protection.requirements) !== 'success') fail('checks_not_successful', '必須CIがすべて成功していないためマージを中止しました。');
    await this.assertBase(p.baseSha);
    const currentPr = await this.github.getPullRequest(number);
    this.validatePr(p, currentPr);
    if (currentPr.baseSha !== p.baseSha) fail('base_sha_conflict', '検証したbaseとPRのbaseが一致しません。再検証が必要です。');
    // This GET is diagnostic, not atomic. GitHub strict required checks and non-bypass protection enforce the merge race boundary.
    try { await this.github.mergePullRequest(number, expectedHead); }
    catch (error) { if (!(await this.github.getPullRequest(number)).merged) throw error; }
    return this.result(p, number);
  }
  private async assertBase(base: string): Promise<void> {
    if (await this.github.getBaseSha() !== base) fail('base_sha_conflict', '基準ブランチが更新されました。既存PRを保持し、再検証を要求します。');
  }
}
