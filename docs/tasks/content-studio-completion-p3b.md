# Content Studio Phase 3-B — production runtime and origin recovery

Base: be297000e1a5721dfa92209cb02464b63df9f819. Implementation authorized; no production deployment, external settings, merge, or Phase 3-C.

## Contract fixed before implementation

- A dedicated server release contains bundled Node entry/preflight, a strict file/hash manifest, server-mode PWA and only required legacy images. Pages `dist` remains explicitly mock. No repository static root, external proxy, or test authentication route.
- One process behind an explicitly trusted TLS endpoint. Explicit HTTPS origin, fixed `/tools/content-studio/` and `/api/`; configuration and release validation precede listen. Separate liveness, permissions readiness and protection gate. Finite admission/deadline/outbound budgets; timed-out writes require recovery, not a claim of cancellation.
- OAuth state is browser-bound, expiring, single-use. PKCE S256 verifier lives only in process memory. Callback consumes transient state and redirects to a fixed Studio destination. Stable signing secret survives normal restart; rotation rejects old recovery proofs.
- Existing draft export/import preserves input/artifact correspondence. A separate strict, bounded, non-secret recovery envelope carries frozen artifacts and operation identity, never approval/session/CSRF. Import uses a new local ID. First reconnect is read-only, checks actor/repo/branch/head/base/digest/commit signature/tree, and requires a new diff approval. Unsupported old/mock operations remain preserved and blocked.
- Root game, SW, motion runtime, Rules, existing characters and unrelated worktrees are unchanged. Test boundaries are GitHub/OAuth fixtures behind the real production handler, including isolated HTTPS Chromium at 360/390/412.

## Evidence

Local implementation tests run against this isolated working tree based on the SHA above; a dirty-tree production release's sourceSha identifies its parent checkout, not a committed implementation. Final CI source SHA, run, attempt, results and artifact links are recorded on the Draft PR after committing. A PR validation merge SHA and its head must be distinguished; their trees are compared.

### Reproduced baseline and intermediate failures

- Before the security changes, actual OAuthStateManager accepted reuse of a consumed state and loadConfig accepted the production HTTP origin / placeholder key configuration. Two new unit assertions failed before the fix. This is a code-level fixture reproduction, not a claim of a production incident.
- During HTTPS fixture construction: a self-signed browser context did not permit SW registration; isolated certificate public-key trust replaced it. Manual trace start conflicted with Playwright's automatically started trace. APIRequestContext did not use browser certificate trust; authenticated API assertions now use same-origin browser fetch. No system TLS or cookie protection was disabled.
- The dense-image 412px scenario initially timed out locating the output-size control; selecting its actual combobox role allowed the unchanged actual generator to finish. A later recovery-file typecheck failed on an inferred union; the explicit ArtifactFile contract fixed it.
- The added whole-IndexedDB fingerprint scenario exposed a test ordering race: it approved before the new prepare HTTP response completed; no merge request was sent. The test now waits for that response and the enabled prepare control before asserting the new unchecked approval. Old-origin preservation additionally hashes all stored values and Blob bytes rather than checking IDs alone.
- An environment restart removed the local Chromium executable; all four production tests then failed before browser launch. The lock-version browser was reinstalled. An initial root-directory npx invocation selected an unrelated cached CLI; it was stopped and replaced with the explicitly installed Studio CLI. No dependency lock update was made.
- Windows CRLF initially failed the exact generated-catalog check. Running the normal catalog generator restored its canonical bytes; generated files have no semantic Git change. Dist normalization now removes CR as well as the existing whitespace normalization. These failures are not counted as PASS.
- Local failed reports/traces remain in the isolated worktree's .p3b-evidence directories. They are local evidence, not GitHub-downloadable CI artifacts. CI retains each run/attempt independently and packages its complete reports in bounded parts.

### Verification and evidence contract

- Studio typecheck, unit/integration tests (289 passed, 39 files, zero failed/skipped, exit 0), mock build, server build and catalog check passed locally. Production build/preflight/shipped start and four HTTPS scenarios passed (zero failed/skipped, exit 0). Root npm test passed locally; its multiple individual suite summaries must not be confused with the last 61-test sub-suite.
- The required CI runs the full root entry, legacy identity preservation, motion/cache/invariance tests, existing seat/regression/result/loopback/stage3/lobby tests, Studio E1/E2 and published-edit frontend/backend tests, new production HTTP tests, and actual drawUnit/M1 three-width E2E. Required job names and existing assertions/skips remain unchanged.
- Production tests use the built distribution and HTTP handler, real cookie/session/CSRF/RepositoryService, generator and IndexedDB. Only external GitHub/OAuth responses and the isolated local TLS certificate are fixtures. The shipped CLI is also started as a separate process. PR recovery restarts the actual HTTPS listener and reconstructs handler/session/service in the same fixture process; this is not a full host power-loss test.
- Widths 360/390/412, portrait/touch Chromium, plus a 450px-high viewport cover migration controls and new approval. Original origin data remains intact and local draft IDs differ. Reconnection and repeated resume keep one commit/PR. Fixture merge response loss resolves to the actual merge SHA; it is not a live GitHub merge.
- Core evidence includes results.json, production-results.json, a source/run/attempt manifest, attached scenario JSON and PNGs. Detailed context traces and HTML report resources are separately indexed in at most eight 160MiB parts; oversized evidence fails packaging rather than silently discarding tests.
- Screenshot visual inspection and file/hash checks are separate checks. Chromium emulation is not real Android/IME.

### Memory observation (local, not a host guarantee)

Windows Node v24.14.1, one dense 256px test image generated through the screen: recovery transfer 14,876,791 bytes; canonical snapshot files 11,150,282 bytes. Instantaneous Node RSS before/after the full snapshot read was 451,383,296 / 397,619,200 bytes; heap used 147,167,040 / 174,114,392 bytes. This process also contains the fixture GitHub storage and Playwright client, excludes Chromium RAM and is not peak sampling. Final CI attaches its own environment/readings. Static release is about 11.2MB. Host sizing must additionally budget up to four admitted operations, bounded audit data, JSON/Base64 copies and expected catalog size; this observation does not prove a minimum production RAM contract.

## Safety and external acceptance

Recovery draftContentHash is an untrusted matching aid, not a signed claim about private originals. Client canonical/character/hash and unapplied-setting checks reject accidental or inconsistent pairing. Authority remains the backend's existing signed commit attestation, tree/files, actor and revision validation, followed by fresh diff approval. Imported approval is never trusted. Information-only editing, current input correspondence, immutable artifacts, no-op, A conflict/B preservation and outbox-dependent deletion guards remain in place.

Deployment/environment steps, setting names, fixed callback, permissions/protection, proxy logging, restart/key-rotation/migration/rollback instructions are in [server/PRODUCTION.md](../../tools/content-studio/server/PRODUCTION.md). No real secrets are read, configured or committed. No host, domain, production deploy, App/OAuth/protection/Rules or unrelated PR is changed.

Open conditions: real host/OAuth/App/protection/publication acceptance, Firebase/ONLINE registration (Phase 3-C), inputKey-less old outbox, full PWA/offline/update/quota anomalies, real Android/IME/memory pressure/long resume, existing WebKit skips/flaky terrain and two-tab tests, dependency warnings and initial completion backlog. This PR supplies production-capable code for external audit; it does not declare production connected or Content Studio complete.


OAuth specification consulted: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps (S256 challenge and code_verifier).
