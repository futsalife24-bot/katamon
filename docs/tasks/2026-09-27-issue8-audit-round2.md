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
