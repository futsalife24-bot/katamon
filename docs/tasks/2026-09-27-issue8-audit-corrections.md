# Issue #8 — independent audit round 1 and corrections

- Auditor: normal ChatGPT, [same audit conversation](https://chatgpt.com/c/6ab8c88d-cd48-83e8-b519-d812461f74f3). UI showed Pro; actual model ID is unverified. No Codex subagent used.
- User explicitly approved sending the prepared audit bundle in this task. That approval covers this same-purpose correction/re-audit; it does not approve merge or release.
- Audited base: `48a5182a7b6d27b4838e3b18d197fe08e79890a6`; first submitted HEAD: `fed6875b0f61fcc4193a482e2b0816651d3a15a8`.
- Independent result: **FAIL**, P1 x1 / P2 x3. [Original verdict](2026-09-27-issue8-evidence/audit-round1/independent-verdict.txt). CI success was not treated as audit approval.
- Current corrections are awaiting re-audit. The final submitted correction SHA will be recorded in the PR and follow-up request.

| Finding | Correction | Verification |
|---|---|---|
| F1 P1: losing actor fire/result is mistaken for fire-less concede | Match an active fire before the concede exception; live and replayed fired results use the locally resolved winner and HP | Host/guest losing planner cases; wrong action still rejected; production time-cap defeat replay and activation for both returning seats; packet HP cannot override a fired result |
| F2 P2: 401/403/conflicting 412 followed by 503 becomes a discarded ping | Retry only explicitly transient errors; retain the first hard failure | Mixed hard/transient failures stop after the hard error and reject the following fire |
| F3 P2: queued old fire PUT starts after close | Check closed state before every dispatch/retry and after completion/failure; cancellation returns false | Holding an earlier ping, enqueueing fire then closing; 200 and 503 completions cannot dispatch fire; cancellation on final retry also returns false |
| F4 P2: fire-less concede HP is lost on reload | Apply the already validated terminal HP at activation through the same helper as live fire-less reception | Persisted p1 HP 0 used to restore 100; now restores 0 before result display/recording; normal results still use replayed baseline |

F1 and F2 are integration/regression issues in this PR; F3 and F4 are existing defects within the explicitly requested Issue #8 acceptance. No Rules, wire schema, Gear balance, general snapshot authority or server-side generation contract changed.

All four findings have local pre-fix FAIL and post-fix PASS evidence. The close probe reads the submitted index through a temporary read hook; it never overwrites the working runtime. The result planner and activation tests exercise production helpers. The time-cap integration fixture deliberately starts at turn 29 with unequal HP, then uses real fire physics to obtain the terminal boundary; it does not claim a full 30-turn browser game.

The required six suites were rerun. Stage 3 initially had 2 source-string assertions that referenced the old broad concession branch; both were updated to the narrowed fire-less helper contract and the suite passed 510/510. The other 17 commands passed in the first run. Loopback remains 78 / 89 / 128 / 89 / 89, 103 assertions PASS. No broad npm test rerun was added locally.

Native acceptance reruns initially failed before a room was created: first cold Auth request failed, then full page load exceeded 30s. Those failure logs are retained. The harness now explicitly primes only the local Auth emulator and waits for DOM/runtime readiness rather than every media asset; production request timeout is unchanged. The subsequent browser outcome is recorded separately after completion.

PC WebKit and production A–K remain separate unverified environment checks; they are not described as physical-phone-only coverage. Physical screen lock, OS suspension/process eviction, mobile network changes and PWA/SW behavior still require device acceptance. Issue remains OPEN and the desired terminal state remains **Awaiting manual / real-device acceptance** after correction audit is resolved.

## Additional PC finding L1: short final walk omitted from durable fuel history

The native rerun progressed into a match and rejected guest recovery with `FIREBASE_RECOVERY_REPLAY_MISMATCH:fuel.0`. Captured history showed last move x=239.883 / fuel=78.117, fire x=243.113, and state fuel=74.887. The ordinary 8px movement threshold dropped the final 3.23px step; fire contains coordinates but no fuel. Replay correctly refused to accept the inconsistent candidate.

The correction keeps ordinary movement throttling, but Firebase fire always flushes the existing move packet with exact final position/fuel immediately before enqueueing fire. Broadcast/loopback and co-op behavior are unchanged. No wire field, Rules or snapshot-trust change is introduced. A production-send regression fails before the fix (102 vs expected 99 fuel) and passes after it; it also confirms regular short movement is still throttled.

This prevents newly generated incomplete movement histories. Pre-existing logs that already lack final movement fuel remain fail-closed; their missing authority is not reconstructed from an unverified terminal snapshot. No production history migration is attempted.

Final runtime targeted rerun: **19/19 commands exit 0**, including all six requested suites. Recovery B2/B3A/B3B1/B3B2/live = 13/14/14/20/18; transport = 15 cases. [Final command results](2026-09-27-issue8-evidence/audit-round1/final-results.json). Browser run and re-audit outcome are pending in this commit.

## Final native acceptance

Validated code/test commit: `56423f7e2958e15ac5ee16bc0db4bb630f28f3c7`. Native Chromium on the final runtime **PASS**, local Auth/RTDB emulator with unchanged real Rules and independent host/guest contexts plus a guest replacement tab. Verified both reconnect/reloads, queued old fire cancelled with **0 PUTs**, live turn continuation, stale action/state, old round 401, result-boundary offline, result, both result reloads, rematch, and 750ms delayed state. [Machine record](2026-09-27-issue8-evidence/audit-round1/chromium-acceptance.json). The observed 401 console line belongs to the intentionally rejected old-round write. No unexpected page errors. Initial startup/recovery failures remain preserved above; they are not hidden by the passing run.
