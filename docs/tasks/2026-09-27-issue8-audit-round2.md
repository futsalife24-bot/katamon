# Issue #8 — second audit corrections

Original base: `48a5182a7b6d27b4838e3b18d197fe08e79890a6`.
Second audited HEAD: `53c1a326571b62fedaf9709cf3c9cdd395faeeed` (runtime `56423f7e2958e15ac5ee16bc0db4bb630f28f3c7`).
Independent ChatGPT verdict: **FAIL, P2 x2**, original F1–F4 and L1 resolved. [Verbatim verdict](2026-09-27-issue8-evidence/audit-round2/independent-verdict.txt).

## Corrections

- R1: At result application, require `firebaseActionMatches` for every fired action, including a losing result queued before fire application. Fire-less concession exception remains. Production physics regression covers host/guest and matching/mismatched action IDs; pre-fix FAIL and post-fix PASS (live suite 19 cases).
- R2: At the conditional PUT comparison boundary, normalize only `FIREBASE_REQUEST_TRANSIENT` to the message transient code. Existing finite retry budget, body equality, hard authorization/conflict stop and close cancellation remain. Transport suite 23 cases, with network/abort/408/429/503 comparison failures, exhaustion for ping/fire and GET403. Pre-fix FAIL and post-fix PASS.
- Native browser scenario now persists a real local-emulator ping, loses its PUT response, receives 412, injects GET503, then verifies identical durable content. Observed 3 PUTs / 2 GETs and PASS before later reload failure.

## CI / harness findings

CI on 53c1a32: five checks succeeded; Stage Studio mobile-e2e failed in three recovery fixture cases, with three additional flaky recoveries. The F4 fixture lacked per-message PUT/GET interception and could fall through to external Firebase. Added local mock storage with conditional412/comparisonGET, an explicit persisted-ping assertion and a deny-by-default non-loopback fallback. The new ping assertion failed before the mock route fix. This is a test-isolation correction, not a production permission relaxation. Full F4 rerun and latest CI are still pending in this commit.

The native rerun passed the new GET fault, movement and guest offline/SSE recovery, then failed because the waiting host reached the existing **35s visible-peer timeout during guest reload**. Its failure log is retained. The harness now explicitly reloads that waiting client only for the exact documented timeout, requires playing state and canonical convergence, and records this manual re-entry event. It does not increase the production timer, treat an ended UI as success, or claim 35s+ disconnect is automatic recovery. Final native rerun is pending.

No Firebase Rules/schema, balance, spectator resurrection, production mutation, merge or deployment. Separate unverified checks remain physical phone lock/OS suspension/network switching/PWA, WebKit and production A–K. Issue stays OPEN. Independent re-audit is required before claiming PASS.

## Latest completed checks (code/test 1f01916)

All **19 targeted commands exit 0**, including the six requested suites. Loopback remains **78 / 89 / 128 / 89 / 89**, 103 assertions. [Command summary](2026-09-27-issue8-evidence/audit-round2/round2-results.json).

F4 browser: 12/13 passed, with one Web Lock handoff timed out at 15s (`onlinePhase: null`). The unchanged isolated case then passed in 27.7s. All 13 now have successful execution, but the first failure remains visible. No timeout or lock rule was relaxed. The three previous CI failures all passed.

A later native rerun passed both reconnect/reloads but timed out waiting for the old-tab ping after creating the third tab; both participants had reached the existing peer timeout. That log remains preserved. A further run is in progress with other browser operations paused. Observed free RAM was about359MiB of7.4GiB; resource pressure is a possible contributor, not a proven sole cause.

The third independent audit was sent to the same approved normal ChatGPT conversation for fixed HEAD `1f01916b906a7ea39cdd1506cfe4d4722fdc1e30`, explicitly disclosing all incomplete/failed browser runs. No code audit PASS is claimed yet.

## Final native browser result

**PASS on code/test `1f01916b906a7ea39cdd1506cfe4d4722fdc1e30`** with browser operations run separately. Same unchanged production runtime and real emulator Rules; independent host/guest contexts plus guest replacement tab. Includes the new conditional-write GET503 case, both offline/reconnect/reload, old queued fire0PUT, duplicate/stale action/state, old-round rejection, turn progression, result-boundary offline, both identical result reloads and rematch. [Machine evidence](2026-09-27-issue8-evidence/audit-round2/chromium-acceptance.json), [full run log](2026-09-27-issue8-evidence/audit-round2/round2-native-isolated.log). 56 milestone events, zero page errors; no long-timeout fallback was needed in this final run. Earlier failures remain preserved.

## Independent code verdict

Normal ChatGPT (same user-approved audit conversation) returned **code-only PASS**, R1/R2 resolved, new mandatory findings P0=0/P1=0/P2=0, for fixed code/test SHA `1f01916b906a7ea39cdd1506cfe4d4722fdc1e30`. It independently ran62 transport conditions and28 receive/application conditions using real functions with controlled dependencies. This is not an independent rerun of native browser/Rules or all npm suites. [Verbatim verdict](2026-09-27-issue8-evidence/audit-round2/independent-code-pass.txt).

Its remaining-PC-evidence paragraph reflected the earlier in-progress run. The final same-code native PASS, unchanged F4 failed-case rerun PASS and all6 successful code-SHA CI checks were then submitted as a24,332-byte supplement (SHA256 `d96dc0b582f2a732ba667b700410b5fddafab5ff350ce8e7c6d343c432106b27`). Evidence review is pending; code is unchanged. Evidence-only published commit: `713d67aba9e49e5f37017327c7675b92ddc114ec`.

## Final independent acceptance and handoff

The final normal ChatGPT evidence review confirms **code-only PASS maintained / prior PC acceptance gaps may be closed**. It verified the56 native milestones against the log, page errors0, exit0, queued fire PUT0, result reload/rematch, no timeout-rescue event, F4 failed-case rerun and all6 code-SHA CI successes. This is independent review of submitted evidence, not a claim that ChatGPT executed native Chromium/Rules itself. [Verbatim final verdict](2026-09-27-issue8-evidence/audit-round2/independent-final-acceptance.txt), [screen proof](2026-09-27-issue8-evidence/audit-round2/independent-final-acceptance.png).

The initial F4 timeout cause remains undetermined; successful rerun does not prove flakiness eliminated. All original failures are retained. No code changed after audited SHA `1f01916b906a7ea39cdd1506cfe4d4722fdc1e30`; later commits contain only documents/evidence.

Final state: **Awaiting manual / real-device acceptance**. Issue #8 remains OPEN; PR #404 remains Draft, unmerged and unpublished. Physical phones/PWA lifecycle, PC WebKit and production A–K are separate unverified checks. Merge and normal publication retain their existing approval gates. The source directory is still on its original branch/HEAD with unrelated dirty work; it was never cleaned, switched or modified by this task. Actual Codex model ID/effort were not verifiable; no model switch or subagents. Meloso Judge remains unavailable for this isolated worktree and no paid call was made.
