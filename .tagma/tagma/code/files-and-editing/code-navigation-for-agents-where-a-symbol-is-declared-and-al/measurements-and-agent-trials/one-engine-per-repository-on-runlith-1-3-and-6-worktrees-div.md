---
id: 01a1635a-46c0-7a7a-9f3f-bf2ef2a443e6
title: "One engine per repository on runlith: 1, 3 and 6 worktrees, diverging branches, edit and base shift"
ord: 1
edges:
  - kind: discovered-from
    to: 01a162ca-04c9-7a97-b516-594af7cb9d6c
---
One sample: macOS arm64, 12 cores / 32 GB, TypeScript 7.1.0-beta, runlith at HEAD 93872ea579 (114 tsconfigs), under unrelated load — load average 4–20, almost no free memory, so p90 spreads wide. The base was a temporary worktree with its own dependency install; six worktrees of the same HEAD each edited two files — in `packages/agent` (included by four programs) and in `apps/tagma/server`: the worst case for shared programs. Diverging branches were HEAD~10, ~100, ~1000 (the last one has a different `bun.lock` and no install of its own). Scripts were `layers.ts` (adapter directly, no ripgrep, live-heap analysis via `saveHeapProfile`) and `bench2.ts` (built launcher and navigation kit with ripgrep, memory as `phys_footprint` of the engine process tree, a 10 GiB share as from the holder) in the scratch of thread 01a162fe-ce39-701c-80f4-cdd660a2e485; worktrees were deleted after the measurements.

**Layer with no memory limit** (`layers.ts`, adapter questions without ripgrep, p50 / p90 over seven benchmark symbols):
- live heap: base 2.65 GB; with 1 worktree 3.69; with 3 — 6.17; with 6 — 10.56. Each worktree with an edit in `packages/agent` adds 1.0–1.3 GB — checkers of four changed programs; releasing worktree snapshots returns the heap to 3.8 GB (base and one worktree);
- deriving a worktree snapshot from the base takes 0.2–1.6 s, the first round of questions on it is cold (first question 9–15 s, up to 41 s under load), warm ones are 203–322 / 349–668 ms at each of 6 worktrees with 230 / 496 ms on average over all;
- an edit in a worktree: the snapshot refreshes in 0.15 s, the next answer sees it, a neighboring worktree does not; a base file shift pins in each worktree in 1–2 ms, and their answers stay warm (206–217 ms p50);
- benchmark 74 of 74 on every worktree snapshot.

**Layer cost on branch divergence** (`layers.ts`): 12 / 120 / 1408 differing files (89 KB / 0.7 MB / 19 MB) — snapshot derivation 0.5 / 0.3 / 1.4 s, live heap +0.85 / +0.83 / +1.22 GB, first question 6.3–7 s, warm 335–688 ms; snapshot release in 32–36 ms returns the heap exactly to base.

**Built engine with a 10 GiB share** (`bench2.ts`, whole kit question with ripgrep; memory as `phys_footprint` of client and `tsc`):
- base: 2.4 GiB after load, 4.7 after two rounds; cold first question 12 s, warm 640 / 1411 ms, benchmark 74 of 74;
- 1 worktree: 5.1 GiB, all answers 495 / 1172 ms;
- 3 worktrees: 7.0 GiB, 512 / 1524 ms; two hold their own snapshots, the third answers from the base snapshot;
- 6 worktrees: 7.1 GiB, 620 / 2405 ms; two hold their own snapshots, four answer from the base snapshot; on their own snapshots the benchmark is 74 of 74, on the base snapshot 69–74 of 74, with the remaining places standing as "changed after snapshot" lines in the two diff files of that worktree;
- worktree attach 0.6–4.5 s (git difference from base), first answer from the base snapshot 466–958 ms p50; its own snapshot warms up in the background in 7–10 s;
- an edit in a worktree shows in the next answer as "changed after snapshot" (1.3 s), its snapshot accepts it in 14 s, after which it is a call; a neighboring worktree does not see it;
- worktree HEAD~1000 attaches in 3.3 s with 1409 diffs and answers from the base snapshot: 28 of 74 benchmark places, the rest "changed after snapshot".

With no memory headroom for re-warming, the third and fourth worktrees got their own snapshots, memory reached 9.4 GiB at `GOMEMLIMIT` 9 GiB, and the collector stretched edit absorption to 40 s and the first answers after an edit and base shift to 6–9 s; hence the warmup rule in [[de373e6a]].

For comparison: the previous engine cost 3.5–4.5 GB RSS per checkout on runlith, and this machine's budget admitted two such engines.
