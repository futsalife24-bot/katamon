// Test-only loopback server: real frontend/API/service/validation; only GitHub is in memory.
import { createServer } from 'vite';
import { createApiHandler } from '../../server/app';
import { GitHubClient } from '../../server/github-api';
import { RepositoryService } from '../../server/repository-service';
import { SessionStore, SESSION_COOKIE, secureCookie, AuditLogger } from '../../server/security';
import { validateSubmission } from '../../server/validation';
import { submittedFile, validatedBundle } from '../unit/server-fixtures';
import { serverTestConfig } from '../unit/server-fixtures';
import { FixtureRepository } from '../unit/repository-fake';
process.env.VITE_REPOSITORY_MODE = 'server';
const config = serverTestConfig({ PUBLIC_APP_URL: 'http://localhost:4177', RATE_LIMIT_MAX: '10000' });
let readFault: 'missing'|'hash'|'slow'|null=null;
let repo: FixtureRepository, sessions: SessionStore, handler: ReturnType<typeof createApiHandler>;
function reset() {
  repo = new FixtureRepository(); repo.safe = false; readFault=null;
  const read=repo.getBlob.bind(repo);
  repo.getBlob=async sha=>{const path=repo.tree.find(e=>e.sha===sha)?.path;if(path?.includes('published-a')){if(readFault==='slow'){readFault=null;await new Promise(resolve=>setTimeout(resolve,1500));}if(path.endsWith('icon.png')){if(readFault==='missing')throw new Error('fixture image missing');if(readFault==='hash')return Buffer.from('fixture corrupted bytes');}}return read(sha);};
  sessions = new SessionStore(config.sessionTtlMs);
  const github = new GitHubClient(config);
  github.getChecks = repo.getChecks.bind(repo); github.getDeployment = repo.getDeployment.bind(repo);
  handler = createApiHandler({ config, github, repository: new RepositoryService(config, repo), sessions, audit: new AuditLogger(config.sessionSecret, () => { }) });
}
reset();
const server = await createServer({
  server: { host: 'localhost', port: 4177, strictPort: true, proxy: {} }, plugins: [{
name: 'local-api-fixture', configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith('/__fixture/')) {
          if (req.url === '/__fixture/reset') reset();
          if (req.url === '/__fixture/add-b' || req.url === '/__fixture/conflict') {
            const original = validatedBundle(), slug = req.url.endsWith('conflict') ? 'recovery-unit' : 'unit-b';
            const value = validateSubmission({ ...original, bundleId: slug, character: { ...original.character, id: slug, slug }, files: original.files.map(f => submittedFile(f.path.replaceAll('sample-unit', slug), f.mimeType, f.mimeType === 'application/json' ? Buffer.from(f.bytes.toString().replaceAll('sample-unit', slug)) : f.bytes)) }, config);
            const publisher = new RepositoryService(config, repo), p = await publisher.prepare(value, '123'), pr = await publisher.createPullRequest(p.id, value, '123'); repo.advanceTo(pr.commitSha);
          }
          if(req.url==='/__fixture/missing')readFault='missing';
          if(req.url==='/__fixture/hash')readFault='hash';
          if(req.url==='/__fixture/slow')readFault='slow';
          if(req.url==='/__fixture/clear-fault')readFault=null;
          if(req.url==='/__fixture/old-record'||req.url==='/__fixture/target-update'){
            const service=new RepositoryService(config,repo),snapshot=await service.readPublishedCharacter('published-a','123');
            const record=structuredClone(snapshot.record);
            if(req.url.endsWith('old-record')){delete record.editing;delete record.assets.editSourcePng;delete record.assets.editHitPng;}
            else record.character.displayName='別端末から更新したA';
            const paths=new Set<string>();for(const [key,value] of Object.entries(record.assets))if(key!=='directory'&&value){if(typeof value==='string')paths.add(value);else Object.values(value).forEach(p=>paths.add(p));}
            const value=validateSubmission({bundleId:'fixture-'+repo.commits,generatorVersion:record.generatorVersion,character:record.character,sourceRevision:snapshot.revision,prBody:'Local fixture only',files:snapshot.files.filter(f=>f.path.startsWith('content/characters/')||paths.has(f.path)).map(f=>f.path.startsWith('content/characters/')?submittedFile(f.path,'application/json',Buffer.from(JSON.stringify(record))):f)},config);
            const prepared=await service.prepare(value,'123'),pr=await service.createPullRequest(prepared.id,value,'123');repo.advanceTo(pr.commitSha);
          }
          if (req.url === '/__fixture/advance-last') { const head=[...repo.refs.values()].at(-1); if(head)repo.advanceTo(head); }
          if (req.url === '/__fixture/catalog-state') {
            const files=[];for(const e of repo.tree)if(e.path.startsWith('content/characters/')||e.path.startsWith('assets/content-studio/'))files.push({path:e.path,sha:e.sha,...(e.path.endsWith('.json')?{json:JSON.parse((await repo.getBlob(e.sha)).toString())}:{})});
            res.setHeader('Content-Type','application/json');res.end(JSON.stringify({files,branches:repo.branches,prs:repo.pullRequests,commits:repo.commits}));return;
          }
          if (req.url === '/__fixture/session'  || req.url === '/__fixture/reset') res.setHeader('Set-Cookie', secureCookie(SESSION_COOKIE, sessions.create({ id: 123, login: 'allowed-user' }).token, 3600));
          res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ branches: repo.branches, prs: repo.pullRequests, heads: [...repo.refs.values()], base: repo.baseSha })); return;
        }
        if(req.url?.startsWith('/assets/content-studio/')){const e=repo.tree.find(e=>'/'+e.path===req.url);if(e){res.setHeader('Content-Type',e.path.endsWith('.webp')?'image/webp':'image/png');try{res.end(await repo.getBlob(e.sha));}catch{res.statusCode=404;res.end();}return;}}
        if (req.url?.startsWith('/api/')) { void handler(req, res); return; } next();
      });
    }
}]
});
await server.listen();
