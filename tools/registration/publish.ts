import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { buildRegistrationCandidate } from '../content-studio/src/generation/registration';
import { canonicalCharacterRecordSchema, type CanonicalCharacterRecord } from '../content-studio/src/generation/catalog';
const require = createRequire(import.meta.url);
const { publish, REPOSITORY } = require('./publisher.cjs');
const { createStore } = require('./firebase-store.cjs');
const { approvalMode } = require('./approval-policy.cjs');
const root = resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const sha = process.argv.find(v => v.startsWith('--sha='))?.slice(6);
const apply = process.argv.includes('--apply');
if (!sha || !/^[a-f0-9]{40}$/.test(sha) || process.argv.slice(2).some(v => v !== '--apply' && v !== '--dry-run' && !v.startsWith('--sha='))) throw new Error('Use --sha=<merged SHA> [--dry-run|--apply]');
const pages = 'https://futsalife24-bot.github.io/katamon/';
async function bytes(url: string, maximum: number, headers: Record<string,string> = {}) {
  const response = await fetch(url,{redirect:'error',headers,signal:AbortSignal.timeout(20000)});
  if (!response.ok || Number(response.headers.get('content-length') || 0) > maximum) throw new Error('publisher.readUnavailable');
  const reader = response.body?.getReader(); if (!reader) throw new Error('publisher.readUnavailable');
  const parts: Uint8Array[] = []; let length = 0;
  try { for (;;) { const {done,value} = await reader.read(); if (done) break; length += value.byteLength; if (length > maximum) throw new Error('publisher.readCapacity'); parts.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(parts,length);
}
async function github(path: string) {
  const headers: Record<string,string> = {Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  if (process.env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
  return JSON.parse((await bytes(`https://api.github.com/repos/${REPOSITORY}/${path}`,4*1024*1024,headers)).toString('utf8'));
}
function gitFile(path: string) {
  if (!['index.html','shared/content-studio-registration.js','shared/content-studio-registration-game.js','coop-mvp-room.js','coop-mvp-battle.js'].includes(path) && !/^content\/characters\/[a-z][a-z0-9-]{0,23}\.json$/.test(path)
      && !/^assets\/(characters|content-studio)\/[a-zA-Z0-9/_.-]+$/.test(path)) throw new Error('publisher.sourcePath');
  return execFileSync('git',['show',`${sha}:${path}`],{cwd:root,maxBuffer:6*1024*1024,stdio:['ignore','pipe','pipe']});
}
const repository = {
  name:REPOSITORY,
  async isAncestor(base: string, head: string) {
    if (!/^[a-f0-9]{40}$/.test(base) || !/^[a-f0-9]{40}$/.test(head)) return false;
    const comparison = await github(`compare/${base}...${head}`); return comparison.status === 'ahead' || comparison.status === 'identical';
  },
  async proveMerged(sourceSha: string) {
    const master = await github('branches/master');
    const prs = await github(`commits/${sourceSha}/pulls?per_page=100`);
    const merged = prs.some((pr: any) => pr.merged_at && pr.merge_commit_sha === sourceSha && pr.base?.ref === 'master' && pr.base?.repo?.full_name === REPOSITORY)
      && await this.isAncestor(sourceSha,master.commit.sha);
    return {merged,base:'master',sourceSha};
  },
  async rebuild() {
    const paths = execFileSync('git',['ls-tree','-r','--name-only',sha!,'--','content/characters'],{cwd:root,maxBuffer:1024*1024,encoding:'utf8'}).trim().split('\n').filter(Boolean);
    if (paths.length > 500) throw new Error('publisher.recordCapacity');
    const records = paths.map(path => {
      const record = canonicalCharacterRecordSchema.parse(JSON.parse(gitFile(path).toString('utf8'))) as CanonicalCharacterRecord;
      if (path !== `content/characters/${record.character.slug}.json`) throw new Error('publisher.recordIdentity'); return record;
    });
    return buildRegistrationCandidate(records,gitFile('index.html').toString('utf8'),async path => gitFile(path));
  },
  async deployment(sourceSha: string) {
    const deployments = await github(`deployments?sha=${sourceSha}&environment=github-pages&per_page=100`);
    const deployment = deployments.find((d: any) => d.sha === sourceSha && d.environment === 'github-pages');
    if (!deployment) throw new Error('publisher.notDeployed');
    const statuses = await github(`deployments/${deployment.id}/statuses?per_page=100`);
    return {sourceSha:deployment.sha,environment:deployment.environment,state:statuses[0]?.state};
  },
  async readDeployedCandidate() { return JSON.parse((await bytes(pages+'generated/content-studio-registration.json',2*1024*1024)).toString('utf8')); },
  async verifyDeployedRuntime() {
    for (const path of ['index.html','shared/content-studio-registration.js','shared/content-studio-registration-game.js','coop-mvp-room.js','coop-mvp-battle.js']) {
      if (!gitFile(path).equals(await bytes(pages+path,6*1024*1024))) return false;
    }
    return true;
  },
  readDeployedAsset(path: string, maximum: number) { return bytes(pages+path,maximum); },
};
async function main() {
  let database, expectedActive = null;
  if (apply) {
    if (process.env.REGISTRATION_APPLY_APPROVED !== 'true' || !process.env.REGISTRY_DATABASE_ORIGIN || !process.env.REGISTRY_ACCESS_TOKEN) throw new Error('publisher.applyNotConfigured');
    const environment = await github('environments/content-registration-production');
    approvalMode(environment, process.env.REGISTRATION_APPROVAL_MODE || 'independent');
    database = createStore({origin:process.env.REGISTRY_DATABASE_ORIGIN,token:process.env.REGISTRY_ACCESS_TOKEN,approved:true});
    expectedActive = (await database.read('active')).value;
  }
  const result = await publish({sourceSha:sha,apply,expectedActive,repository,database});
  process.stdout.write(JSON.stringify(result)+'\n');
}
main().catch(() => { process.stderr.write('Registration stopped: verify merged source, game deployment, approval and registry configuration. No secret values are logged.\n'); process.exitCode=1; });
