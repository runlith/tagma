---
id: 01a165ab-b91a-760c-b5ee-a6500fc34062
title: A navigation engine nobody asks does not warm snapshots under a code-edit stream
ord: 40
tags: ["task"]
fields:
  {
    "holder": "tagma:01a165ac-1866-759f-9392-e4764cb209c7",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1612d-2135-7f12-8deb-91b934378e8f
sources:
  - kind: file
    ref: packages/navigation-ts/src/engine/workspace.ts
---
After [[d5041faf]] almost all engine cost is code edits: every program edit produces a new snapshot, a new checker, and warm-up by repeating up to 12 last questions (`warm`/`pump` in `packages/navigation-ts/src/engine/workspace.ts`). A live measurement on runlith (one sample, 9 min, 89 files changed by other sessions, almost no questions): `tsc --api` averages about one core, 4–6 GB.

The "last questions" window is a counter, not time: an engine nobody asked for an hour still warms every edit with the same questions. Agents edit continuously and rarely ask navigation, so the engine warms snapshots nobody will ask for.

Goal: an engine nobody asks spends almost no CPU or memory under an edit stream, while the answer stays fast and honest — whatever is not checked on a fresh snapshot, the answer names ("changed after the snapshot"). The choice of device, its accuracy cost, and the first-question latency after quiet are the performer's, by measurement.

Acceptance: a before/after measurement on runlith under a realistic edit and commit stream, with and without questions; CPU, memory, and answer-latency figures recorded in the task.

## Device

TypeScript-base and worktree-own snapshots update only on demand: an answered question starts receiving everything accumulated plus warm-up ([[61d1db53]]). Before demand, touches accumulate and their paths stand in the answer's `changed`, i.e. "changed after the snapshot", with `warming`. Without a question the base takes only the changed lockfile. A deferred base `rescan` counts differences from the taken snapshot (`held`), not from HEAD. A defect found along the way: a HEAD touch followed in the same batch by a path touch passed a stale `drift` to `held.move`, and a path whose edit the snapshot had taken dropped out of the blob set — the next HEAD shift missed its return to HEAD; the "a moved HEAD alone…" test catches it when a HEAD touch and an edit land in one batch.

## Before/after measurement

One sample: macOS arm64, 12 cores / 32 GB, TypeScript 7.1.0-beta, `GOMEMLIMIT` 8 GiB, `GOMAXPROCS` 4, `GOGC` 50, machine under others' load (load average 4–24). Scenario — same as in [[d5041faf]]: a local runlith clone, the engine through the launcher, a repeat of 40 commits `ed83ab2b06^..e1a8111b26` (10 with code edits, the rest graph), onto each — file writes and path touches, then `git reset --mixed` and a HEAD touch; each phase waits until the snapshot takes everything, or 1.5 s with no engine CPU. Two loads: no questions, and two `uses` questions after each code edit. After the stream — "first question after quiet", then receiving plus three more questions. The `bench.ts` script and raw `bench-*.jsonl` rows are in the scratch of thread 01a165ac-1866-759f-9392-e4764cb209c7. "Before" is a package copy at 6924234536.

Engine-tree CPU time over the whole 40-commit stream and memory (`phys_footprint`):

| Load | Before | After |
|---|---|---:|
| no questions, CPU | 185 s | 5.8 s |
| no questions, memory in stream | peak 6.1 GiB, 5.6 at end | peak 3.9 GiB, 3.7 at end |
| question after each code edit, CPU | 273 and 214 s (two runs) | 133 and 205 s |
| question after each code edit, memory | peak 6.5–6.7 GiB | peak 6.0 GiB |

Without questions the engine no longer builds snapshots: 3.5 s of 5.8 is path touches and HEAD shifts (git counting). With a question after each code edit the device work is the same, only it runs after the answer instead of before; the 133–273 s spread between runs is the machine's outside load, not the device (the second pair ran together: 214 vs 205 s).

The cost is the first question's latency and accuracy after quiet. After a question-less stream (90 files behind), the first `uses release` answered in 1.9 s from the old snapshot: 14 places instead of 15 and 61 "changed after the snapshot" rows in changed files, `warming`. Receiving the accumulated backlog then took 11 s on the wall and 16 CPU-s, and the next questions answered accurately in 0.35–1.1 s. "Before" answered the same first question in 1.2 s with no unverified rows. With questions after each edit, "after" answers carried 49 "changed after the snapshot" rows over 20 answers — edits made just before the question; "before" had none because the edit phase waited for warm-up. Answer times in the first run pair (in turn): 156–831 ms, median 380, vs 170–3357 ms, median 650; in the second (together): medians 636 and 625 ms.
