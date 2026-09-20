# Single-instance production distribution

This phase supplies deployable code. No host, domain, OAuth/App, secret, protection or production publication is configured by this PR. Pages remains the mock Studio and the authoritative game host. Studio host deployment is not game `github-pages` deployment.

## Build and inspect (no credentials at build time)

Use Node 22 and the locked dependencies:

```sh
npm ci
npm run production:build
# Supply production environment through the host secret store, then:
npm run production:preflight
npm run production:start
```

### Cloud Run packaging (optional host)

The repository includes a production-only image definition at
`tools/content-studio/Dockerfile` and a Cloud Build config at
`tools/content-studio/cloudbuild.yaml`. Build from the repository root so the
trusted legacy images can be copied into the release:

```sh
docker build -f tools/content-studio/Dockerfile \
  --build-arg SOURCE_SHA="$(git rev-parse HEAD)" .
```

Cloud Build supplies `$COMMIT_SHA` to the same build argument. The image only
contains the generated `production/` directory; source files, `.env` files,
Git metadata, and npm dependencies are left in the build stage. At runtime
Cloud Run must provide the required environment settings through its secret
store, keep one instance (or sticky routing), and set the public HTTPS origin
as `PUBLIC_APP_URL`. The image does not enable mock mode and exits when the
production preflight rejects configuration or the release manifest.

Distribute the entire `production/` directory privately and run `node production/server.mjs`. It contains the bundled Node entry/runtime/preflight modules and `release.json`, plus only the PWA and existing legacy image copies under `public/`. No runtime npm install, Vite server or container is required. The Node process binds to loopback by default. HTTPS terminates at the host/reverse proxy. Do not expose the Node port directly.

`npm run build` explicitly builds **mock** `dist/` for Pages. `production:build` explicitly builds **server** `production/`. Both ignore `.env` during Vite compilation; only their overridden, non-secret mode/version/API flags are used. Neither backend failure nor missing configuration changes a server client into mock mode. Runtime and release version, mode, required files, MIME, bounded sizes and complete SHA-256 values are checked before listening. HTML, SW and unversioned legacy images use `no-cache`; hashed JS/CSS/Workers use immutable caching. Studio SW excludes all routes outside its narrow app scope, including `/api` and OAuth navigations. The root game SW is never distributed or registered here.

## Required external settings, in order

1. Choose a long-lived fixed HTTPS origin supporting one Node 22 process, loopback/private upstream access, environment secrets, graceful restart and logs without query strings or bodies. Do not use a development tunnel as the normal address. No vendor-specific hosting resource has been created. Capacity must be validated with the included fixture measurements and actual expected catalog size before selection.
2. Set `PUBLIC_APP_URL` to the HTTPS **origin only**. App path is fixed `/tools/content-studio/`; callback is fixed `/api/auth/callback`. Credentials, paths other than `/`, query and fragment are rejected. Set `NODE_ENV=production`, `HOST` (normally `127.0.0.1`) and `PORT` (normally `8787`). Set `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BASE_BRANCH=master` to the intended fixed repository.
3. Configure the existing OAuth App callback at that origin and supply `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET`. OAuth authenticates the allowed human; it is not repository authorization. Supply comma-separated `ALLOWED_GITHUB_USERS`. OAuth uses browser-bound, ten-minute, single-use state and PKCE S256; verifiers stay in bounded server memory. Return destinations are fixed. Success/error callbacks redirect away from protocol parameters. Cancelled, expired, replayed or restart-lost state requires a new login.
4. Install the GitHub App on the **fixed repository only**. Supply `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, and RSA (at least 2048 bits) PEM `GITHUB_PRIVATE_KEY`. Required repository permissions: Contents and Pull requests **write**; Actions, Checks, Commit statuses, Deployments, Administration and Metadata **read**. App/installation identity, suspension, permissions and fixed-repository access are rechecked independently of OAuth. Installation tokens are additionally restricted to the configured repository. Grant no protection bypass.
5. Supply a stable random `SESSION_SECRET` of at least 32 characters. Keep it across ordinary restarts and legitimate same-repository host migration. Sessions and pending OAuth states are memory-only; restart therefore requires reauthentication. Recovery attestations remain valid only with the same secret, repository/base identity and same GitHub actor. Intentional key rotation invalidates old signatures: preserve old drafts/packages/PRs and stop recovery; never remove signature checks or guess replacement associations.
6. Configure master protection externally: strict required status checks with their GitHub Actions source, enforce administrators, no force pushes/deletion/bypass. Preserve the two required Studio jobs, `Type, unit, integration, build and regression` and `Android 13 portrait Chromium E2E`, plus required root/Stage `test` and `mobile-e2e` jobs. Confirm their exact current workflow/source identities and ensure they run for every affected PR before making them mandatory; do not alter unrelated PRs such as #83. Protection read access needs Administration read. Unknown/unsafe protection stops production publication and merge, while local drafts and read-only PR recovery remain available.
7. Run preflight, start, inspect `/api/health`, authenticate, and read `/api/github/status`. Health is liveness/configuration/build identity only; it explicitly reports readiness `not_checked`. Authenticated status independently reports repository access and protection. `connected` means human authentication, not permission to publish. Verify the actual fixed SHA CI and game `github-pages` deployment separately from this host rollout.

Settings may be injected by the host or process environment; the server does not load a committed env file. `.env.example` contains names and dummy explanations only. No secret value belongs in VITE variables, build commands, Git, logs, screenshots, PRs or migration packages. Preflight errors identify setting names and remediation, never values. Production rejects additional allowed origins and arbitrary exact repository paths.

## TLS/proxy and limits

Keep upstream private/loopback. Default `TRUST_PROXY=false` ignores forwarded identity headers. If a trusted proxy is necessary, set `TRUST_PROXY=true` and `TRUSTED_PROXY_ADDRESSES` to its exact socket IP(s); the proxy must **overwrite**, not append untrusted forwarded headers. Node does not infer public scheme/origin from forwarded headers. The configured HTTPS origin and exact Host header control routing.

Proxy requirements: TLS, fixed upstream Host matching `PUBLIC_APP_URL`, 24MiB request cap, finite header/body timeouts (15/30 seconds), upstream response timeout slightly over 90 seconds, access/error logs omitting request arguments, cookies, authorization headers and bodies. In Nginx log `$request_method $uri $status`, never `$request` or `$args`; apply equivalent rules to the hosting provider. Disable tracing/APM request payload capture for OAuth/API routes. Do not relax Secure/HttpOnly/SameSite=Lax cookies for a proxy.

Node header cap is 16KiB, receive-body requestTimeout 30s, headersTimeout 15s, keepalive 5s and 100 requests/socket. These are distinct from the **90s handler deadline**. At most four API handlers and four outbound GitHub operations are admitted; each outbound has a 15s deadline and response-byte cap. Non-cooperative work keeps its outbound slot until real completion. Expired operations cannot start later GitHub requests; an already accepted remote write is not cancelled by a timeout, so retry through existing-PR recovery. OAuth pending states and sessions each cap at 256. Rate limits are per socket IP or explicitly trusted proxy identity.

Publication limits remain 6MiB/file, 16MiB total, 32 files, 24MiB request including Base64. Public release data caps at 32MiB; prepared operations at 64MiB. Existing full base-reference audit limit remains 256MiB/request. These budgets do not guarantee process RSS: four concurrent full audits, Base64/JSON temporaries, Node heap and static buffers must be included when sizing a host. Included measurements identify fixture/runner overhead and are not browser/Android RAM figures. Do not choose a host from the small empty-catalog liveness measurement alone.

## Origin migration and recovery

Keep the old Pages/PWA/origin intact. From the old origin, explicitly export the relevant **draft JSON**, which includes local originals/images/settings and is a private user backup. Import it on the new origin; import creates a new local ID and preserves unapplied-setting guards and generated asset hashes. Existing target drafts are not overwritten. An incomplete/quota-failed import is not successful. This does not migrate approvals, authentication or outbox automatically.

For a current server operation, separately export its **recovery package**. It includes only frozen public artifacts, a content hash for the explicitly selected migrated draft, actor/repository/branch/base/digest and optional PR/head hints. It excludes camera originals, local editing history, cookies/session/OAuth/CSRF and approval state. File/schema/size/hash validation is mandatory. On the new origin, reauthenticate as the same user, select the imported draft, then import the recovery package. Initial connection is read-only: the backend must find a real existing PR and recheck signed commit/tree, frozen artifacts, actor, repo, branch, head and parent base. Unknown or changed PRs remain blocked. Response-loss discovery can use the signed branch if the old client never received the PR number. A package exported before any PR exists is only a preserved reference; initial recovery will not create a PR.

Use `既存PRを確認・再開` to obtain a fresh preparation/diff; prior approval is absent. Repeated imports identify the existing local operation and require its resume control instead of duplicating PRs. Merged PRs are read-only results: inspect actual merge SHA deployment or use published-character re-edit. Closed unmerged PRs and different signing keys/accounts/repositories are rejected. Mock and old inputKey-less histories cannot become real GitHub success. Keep them and their original origin; no heuristic association or sweeping old-outbox migration occurs here.

## Rollout/rollback and remaining acceptance

Archive a complete verified previous distribution before a host rollout. Preflight a new release with the same required settings, replace the complete directory as one host deployment, restart one instance, and validate identity/health/auth/static/SW. Roll back the full distribution and matching supported environment, not selected JS files. Do not delete origin storage or rotate signing keys as rollback. A newer draft/checkpoint may not be safely editable by older clients; preserve backups and stop unsupported editing rather than downgrading data.

Local/CI `npm run test:production` uses the built runtime, real HTTPS routing/cookies/API/RepositoryService, real image generator and IndexedDB. Only external OAuth/GitHub and an isolated one-day test certificate are fixtures. Chromium trusts only that certificate public key in its isolated process; system TLS validation and production cookies are unchanged. Full production host/OAuth/App/protection/game deployment completion still requires the external steps above and an authorized real end-to-end run. Real Android/IME, long resume, memory pressure, full PWA failure modes, old outbox migration, Firebase/ONLINE registration (3-C), existing skips/flakes/dependency warnings remain open.

PKCE reference: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
