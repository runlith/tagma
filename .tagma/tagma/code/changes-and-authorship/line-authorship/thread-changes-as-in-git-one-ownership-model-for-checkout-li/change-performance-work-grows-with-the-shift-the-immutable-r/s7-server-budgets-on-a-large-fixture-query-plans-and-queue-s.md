---
id: 01a11681-3d09-70d2-97f5-12e4bd19ac52
title: "S7: server budgets on a large fixture, query plans, and queue spans"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11742-4fb0-708f-888e-2a315384fa1f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1166f-7113-7752-b6b9-0a78f16c4571
  - kind: waits-on
    to: 01a11681-3d09-70d2-97f5-12e0368b0def
---
Verify the S3–S5 server delivery against the [[f16c4571|performance-spec budgets]] in `main`: intake, cold build and non-blocking Holdings reads, one-path change, HEAD +50 commits, memory, O(1+k) git processes, index query plans, and queue/worker spans. On the agreed work split, delivery to `thread.changes`/`holdings.subscribe` and the panel's first frame are accepted separately after S6.

## Delivery

`72037abb55` — a real Git/SQLite/worker fixture 20,000 tracked / 5,000 held / 10 threads / 1,000 main-thread paths, system measurement, one-change-out-of-1,000 integration, and O(1+k) check in the Git owner. `fb28985219` — intake and Git-cache spans, owner EXPLAIN queries. `ad04e7fc30` — graph-tools preparation in integration fixtures. Walks spans went into `ec69078d1d`, the caller-cancel test into `30ecdce384`. One round of Sol and Muse/performance review ran; confirmed findings are fixed.

## Measurement

Last sample: 2026-10-07 19:26:22 UTC; Apple M2 Max, 12 CPUs, 32 GiB, Darwin 25 arm64, Bun 1.4.2. The system file ran in 28.65 s; structural contracts and memory ceilings are checked by assertions, time goals report separately as `met`/`not-accepted`.

- Intake, 100 measurements: p99 14.78 ms against a 20 ms goal.
- Cold build of 5,000 paths: 5.633 s, loop p99 39.35 ms against a 50 ms goal; owner's first answer 26.77 ms, first change 5.607 s; 9 git processes.
- One-path edit: owner change 82.06 ms, path work 7.70 ms, overhead 74.36 ms against a 100 ms goal. No new HEAD blob reads.
- HEAD +50 / 200 paths: 2,198.18 ms, path work 176.59 ms, overhead **2,021.59 ms against a 2,000 ms goal — not accepted in this sample**; 18 git processes. This is retirement and publish time outside the path-judgement intervals; no single Git/SQL/planner share is isolated. The earlier sample of the same machine before fixture-assembly separation gave 737.54 ms; the time result's portability is unproven.
- Warm judgement 1 / 5,000 paths: 4 / 2 processes. Git reader for 1 / 1,000 paths: 3 / 3; two conversions add exactly 2 processes, working bytes verified.
- Counted folding memory 24,961,120 bytes of 512 MiB; raw cache 1,263,890 bytes of 32 MiB.

## Checks and the proven boundary

Last targeted checks: system 1 pass; incremental, plans, and Walks 5 pass; Git objects 9 pass. Earlier full server unit run: 1,835 pass; Git/change-record/composition/CLI-worktree owner integration run: 372 pass. The wide integration run found errors outside S7 and CPU-budget overruns; they went to the lead and the owners, so the whole integration main is not declared green.

The final `bunx runlith-typecheck .`: a 44-project TypeScript solution passed; the command exited 1 on the S6 UI consumer `apps/tagma/app/src/lib/features/worktrees/FinishDialog.svelte:145,149`: `Property 'holders' does not exist` plus inferred implicit-any, 5 errors total. Fixing the consumer stays with the S6 owner. The earlier full typecheck passed but proves nothing about the post-S6-cut state.

The server measurement mechanisms are delivered; the last sample's full HEAD time budget, S6 delivery, and the panel's first frame stay unaccepted.
