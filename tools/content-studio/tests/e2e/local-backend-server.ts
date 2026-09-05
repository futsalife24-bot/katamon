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
let repo: FixtureRepository, sessions: SessionStore, handler: ReturnType<typeof createApiHandler>;
function reset() {
  repo = new FixtureRepository(); repo.safe = false;
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
          if (req.url === '/__fixture/session' || req.url === '/__fixture/reset') res.setHeader('Set-Cookie', secureCookie(SESSION_COOKIE, sessions.create({ id: 123, login: 'allowed-user' }).token, 3600));
          res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ branches: repo.branches, prs: repo.pullRequests, heads: [...repo.refs.values()], base: repo.baseSha })); return;
        }
        if (req.url?.startsWith('/api/')) { void handler(req, res); return; } next();
      });
    }
}]
});
await server.listen();
