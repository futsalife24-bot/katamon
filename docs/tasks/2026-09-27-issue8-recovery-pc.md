# Issue #8 — PC recovery acceptance (2026-09-27)

Status: **Awaiting manual / real-device acceptance**. The main PC acceptance is complete; independent audit submission and authorized release remain separate gates. Issue #8 stays OPEN. This is the requested approximate 95% preparation point, not a measured guarantee of full production/device coverage.

## Source and protected work

- Repository: https://github.com/futsalife24-bot/katamon, canonical branch `master`.
- Fetched base: `48a5182a7b6d27b4838e3b18d197fe08e79890a6`.
- Working branch: `codex/issue8-recovery-pc`.
- Isolated managed worktree: `C:\Users\futsa\.codex\worktrees\issue8-recovery-pc\カタモン`.
- Original directory `C:\Users\futsa\OneDrive\デスクトップ\カタモン` was dirty on `codex/feat/gear-coop-rewards-phase2d` at `2553db05b204e871c9eb64cca1ba2dd109dd6341`; tracked edits and all old worktrees/untracked files were left untouched. No reset, clean, stash, checkout of an existing branch, or deletion.
- Open PRs at start: #392, #362, #276–#265, #83. None was modified.
- Existing recovery fixes are merged: #333 `53a06ba`, #334 `d5b581f`, #335 `856e9eb`, #336 `0d01fd1`, #337 `a9d8664`, #338 `2ceb19e`, #339 `f608092`, #340 `6d5e5f2`.
- Model ID / reasoning setting: unverified; no model switch or subagents used.

## Existing authority contract

Identity/room-seat validation and an exclusive Web Lock precede recovery. A stored credential is only an identity candidate. The canonical start plus ordered action history are replayed with the production simulation; candidate/local snapshots never become authority. Turn-boundary states are checked against replay, then committed with the original room/round/seat. An incomplete action tail waits for a persisted terminal; recovery does not invent a projectile or another client's result.

`latestSnapshot` is no longer a mutable database authority in the current runtime. The equivalent recovery boundary is reconstructed from canonical start/fire/state/result history. Start owns immutable terrain, while verified turn boundaries restore units, fuel, craters and Gear runtime. UID/seat/round and append-only message checks remain in the actual `database.rules.json`; the Rules, protocol and wire schema are unchanged.

Mid-match spectators were removed by later specifications. Do not resurrect them from the older Issue wording. Occupied 2v2 support seats are players (`s1 -> p2`, `s2 -> e2`), not observers. The existing support-seat recovery test remains part of verification.

## Baseline on current master

The six requested npm suites passed: seat 40 + pointer cancellation 12, regression 477 per seat, result 93, loopback 103, Stage 3 510, lobby 7. Recovery suites B2/B3A/B3B1/B3B2/3D-8C/F4/F5 passed 13/11/14/19/12/4/3; checkpoint 5 and same-owner conflict 5 passed.

Loopback relay counts were **78 / 89 / 128 / 89 / 89** before any runtime edit, matching `docs/tasks/2026-09-12-coop-simultaneous-evidence/existing-regression.log:1248`. The older **38 / 64 / 83 / 61 / 48** is an August historical baseline, before the September ballistic-special changes (`58e2771`, also adjusts `tests/peer.js` to wait for actual projectile settlement). This task does not alter the seed or loopback expectations.

The existing Chromium suite was 11 passed / 1 failed. The failing assertion queried all locks for the origin and wrongly required zero locks after handoff, although the replacement document could already hold the correct lock. It now checks that the old lock client ID is absent. The targeted rerun passed.

## Confirmed corrections

1. Host bfcache `pagehide(persisted=true)` formerly called `endOnline`, removing the active shell and exclusive seat lease. A browser regression failed on the base runtime (room/round/seat became null). The minimal correction retains the host shell/lease for a preserved document, consistent with the existing guest behavior. Reload/document replacement still uses the existing cleanup contract. The new regression passed after correction.
2. A transient liveness `ping` PUT failure poisoned the serial queue, so a short offline interval ended a healthy host session. Native multi-client acceptance and a production-transport regression reproduced it. Only transient ping failures are now discardable; authoritative writes, permission rejection and conflicting push IDs still fail closed. The transport test passed after correction. No arbitrary action or snapshot retry was added.

3. A completed `state` replayed under a fresh push key was treated as a protocol error. Completed state/result identities are now ignored before both reception and queued application. Conflicting sender/unit/type still fails closed. The per-round completed-action cache no longer evicts the oldest entry after 16 actions; the bounded round resets it. Red/green tests cover a stale state and 18 completed actions.
4. Recovery history now ignores a repeated completed fire/state without replacing the first canonical candidate. Replay still verifies that first boundary; mutating the duplicate snapshot cannot grant authority. Red/green plan tests cover this.
5. At the turn cap Firebase previously sent `state`, cleared the action ID, then sent an uncorrelated result. It now retains the action ID and sends only the result terminal, matching the existing co-op rule. Result reception and recovery verify the local, replayed turn count and HP ratios for time-up results. They do not trust the packet's claimed time-up reason or HP. Red/green tests cover sender and receiver; negative tests reject premature/wrong winners.
6. `round.status` can remain `playing` after a valid action-authoritative result. Recovery accepts that immutable result as a candidate and still requires production replay plus the final room/round fence. No metadata write, Rules or schema change was added.
7. A host no longer broadcasts a lobby-state hint in response to re-entry presence during Battle/results. It still reads persisted room authority. The unnecessary hint's transient send failure previously poisoned the battle queue in the native browser test. Lobby/revealing broadcasts remain.
8. Transport freezes the JSON wire body at enqueue time. `craterHistory`/`runStats` can share mutable references with a snapshot; retrying after local progress must use the original body. An injected lost-response regression failed before and passed after this fix. Conflicting persisted content remains rejected.

## Issue #8 coverage and current-spec mapping

| Requirement / timing | Existing implementation | PC evidence / boundary |
|---|---|---|
| A Waiting / room re-entry | Saved identity candidate, room/seat check, native exclusive Web Lock | F4 browser suite and B2; native two-context lobby/start |
| B Moving | Move is a hint; fire's canonical position and replayed physics determine the terminal | Production move+fire replay tests; native movement/fuel acceptance |
| C Aiming | Aim/drag is transient UI, not durable Battle authority | Restore last verified boundary; pointer cancellation suite; unfinished aim is discarded |
| D Projectile in flight | Reconstruct completed chains, wait on an incomplete tail | B3A/B3B1/B3B2 pending-tail tests; native peer offline during action |
| E/F Turn boundary | Verify round/action/turn owner and terminal snapshot, then activate | Native offline, delayed PUT, reload; live ordering tests include terminal-before-fire |
| G Just before result | Action holder owns result; receiver checks settled simulation | Time-cap red/green tests and native result-boundary fault |
| H Results/reload | Verified result candidate and idempotent result ledger | Native both-player reload and old-state-after-result; B3B2 |
| I Rematch | New round identity, local caches reset, old-round writes fenced | Native rematch and actual Rules 401; existing live round tests |
| Host/guest | Same verification with role-specific room/seat context | Independent Chromium contexts plus host/guest reload; Gear ON replay tests |
| Spectator | Mid-match spectator removed | Not applicable; no spectator feature restored. 2v2 support player tests remain |
| Duplicate tab / old client | First document keeps the Web Lock; replacement waits until release | Third tab shares guest storage intentionally; blocked replacement, handoff, closed old transport refused |
| Old action/state | Completed action identities and immutable history | Duplicate and mutated stale state cannot change board or end current client; 18-action retention |
| Old round | RTDB current-round write fence + runtime filter | Fake old round and real prior round after rematch rejected with actual unchanged Rules |
| Snapshot fields | Canonical start + validated action chain | room/round/seat/turn/action, units HP/position/fuel, craters/wind, input ownership compared; candidate HP/fuel/crater corruption rejected by replay tests |

`latestSnapshot` in the old Issue should be read as the verified canonical recovery boundary, not a newly introduced mutable snapshot writer. There is no new wire field or authority owner.

## Fault model and honest limits

- Native browser harness uses real Playwright browser processes, separate host/guest storage contexts, a third same-seat tab, actual local Auth/RTDB emulators and repository Rules. All non-loopback browser requests are blocked. It drives production entry/action functions through a test-only bridge in the served HTML; it is not a full pointer-driven UI test and not a physical phone test.
- Native scenarios cover offline/reconnect, native SSE replacement, reload, document handoff, delayed authoritative PUT, stale/duplicate messages, turn/result/round boundaries. Existing live tests cover reversed terminal/fire arrival, buffering and duplicate events; transport tests inject timeout, network, 408/429/503 and lost-response retries. Permission/action-write failures remain fail-closed.
- Background/foreground and bfcache lifecycle are exercised with browser events; actual OS process suspension, screen lock, radio/network switching, service-worker upgrade and mobile browser eviction remain unverified. The native emulator harness blocks service workers; separate cache-version checks do not substitute for phone lifecycle acceptance.
- If the action owner dies before any terminal is durably saved, the current design waits rather than inventing a result. Restarting both clients at that precise moment is not guaranteed to finish that action. This is an existing authority boundary, not a newly promised recovery behavior.
- Local Web Locks and closed transports fence cooperating same-origin documents. This work does not introduce a server-issued client-generation token or claim to revoke already in-flight authenticated requests / hostile clients sharing the same UID across devices. Rules and protocol remain unchanged.
- Production A–K matrix is not certified by these local tests. No production fault injection, Firebase Console change, DB operation, manual Pages deploy, merge, branch deletion or other-project change was made.
- WebKit was attempted with separate contexts on Windows but the page/browser closed before room creation. It is unverified, not PASS. Android/iOS and installed PWA are still manual checks.

## Final PC results and evidence

Evidence directory: [2026-09-27-issue8-evidence](2026-09-27-issue8-evidence/). `results.json` records every final command's exit code; all 19 succeeded. `*-before.log` / `*-after.log` preserve the red/green observations at the time of each correction. The final suite logs supersede their intermediate assertion counts.

| Final check | Result |
|---|---|
| `npm run test:seat` | 20 p1 + 20 e1 + 6 pointer p1 + 6 pointer e1 |
| `npm run test:regression` | 477 per seat |
| `npm run test:result` | 93 |
| `npm run test:loopback` | 103; 78 / 89 / 128 / 89 / 89 |
| `npm run test:stage3` / `test:lobby` | 510 / 7 |
| B2 / B3A / B3B1 / B3B2 / live 3D-8C | 13 / 13 / 14 / 19 / 16 |
| F4 / F5 / Gear checkpoint / same-owner | 4 / 3 / 5 / 5 |
| Issue #8 transport | 9 cases: transient ping, permission/action failure, closed transport, immutable retry |
| Cache version / STATE size / undefined identifiers | 2 / 1 / 2 |
| F4 Chromium browser | 12 PASS in full run; Gear ON case failed during artifact ZIP/stream cleanup, then 1 PASS on isolated rerun (15.5s). All 13 cases have successful final execution; original failure retained |
| Native emulator Chromium | PASS: independent contexts, movement/fuel, 750ms PUT delay, guest native automatic SSE reconnect, host explicit reconnect, both reloads, duplicate tab handoff, stale action/snapshot, old round, result-boundary offline, both result reloads, rematch |
| Native WebKit | Unverified: page/browser closed before room creation |

An intermediate loopback run returned one extra relay (fifth session 90 instead of 89), while all assertions passed. A focused probe then reproduced it on the **unmodified base runtime**: 4 of 12 special-shot sessions returned 90, eight returned 89; all 228 assertions passed. The base index blob hash is exactly `2b5ea326ea2a3e2c34da4d66b89195f3ca8bf71a`, identical to `git rev-parse 48a5182:index.html`. Packet histograms identify the sole extra packet as a guest `fire` before the final state (16 guest fires instead of 15); all other type/role counts match. This is an existing legacy loopback auto-special end-of-match variation, not a Firebase regression introduced here. Its deeper scheduling/input cause remains a separate observation; the harness or gameplay was not changed to hide it. The final required whole run matched **78 / 89 / 128 / 89 / 89**. No seed, relay or expected count was edited. See `loopback-base-count-probe.log` and its read-only probe script in the evidence directory.

`npm test` was not repeated locally: the requested suites plus affected recovery/transport and native browser checks were run on the final runtime, while CI can perform the broad existing regression. Rules and schema have zero diff.

The copied Meloso Judge entry was invoked from the isolated worktree. Both fixed/live entry calls reported unavailable; neither `latest.json` nor `latest-live.json` was created. The registered connection requires the original canonical directory, which contains protected unrelated dirty changes. Its registration was not changed and those changes were not sent. The CLI rejects this worktree before any API call. Shadow classification is **unjudged**, never independent audit PASS.

## Remaining gates

- Independent ChatGPT audit: packet prepared; not sent, not approved. Applicable canonical workflow §外部顧問 says external transmission needs user approval. No self-review is labelled independent approval.
- Merge and normal release require their existing approval; no Console/Rules/manual Pages operation is included.
- Then run [the two-phone OK/NG checklist](2026-09-27-issue8-mobile-acceptance.md). Physical Android Chrome / iPhone Safari lock, network switch, browser suspension and installed-PWA lifecycle remain human checks. Production A–K remains unconfirmed until the corresponding real acceptance is recorded.
