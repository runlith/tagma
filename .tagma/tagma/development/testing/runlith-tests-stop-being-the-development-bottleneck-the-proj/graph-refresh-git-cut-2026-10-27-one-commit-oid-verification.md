---
id: 01a17b24-4913-74f0-a62b-5d0e724531d7
title: "Graph refresh git cut, 2026-10-27: one commit-oid verification per scoped read instead of two"
ord: 59
edges:
  - kind: discovered-from
    to: 01a17ad9-53ab-70cb-9a5f-ee5de872922e
  - kind: discovered-from
    to: 01a17b10-70af-7d09-bc4b-d7dec25a38cd
---
In `graph/tree/freshness.ts` one repeat verification of `<oid>^{commit}` is removed in every scoped read where the mirror stamp matched the earlier HEAD. `movedPaths` passes the already resolved full oid through `TreeSeen` into this same pass's `readTree`. Matching against the freshly read stamp is verified at the earlier place; a different stamp, the whole fallback, and the next call verify with git as before. No consumer cache, no snapshot passing across repository holds; diff commands, spans, error statuses, and their texts never changed.

## Chain and boundary

The only product caller of `readTree` with scope is `FreshnessGate.refresh`: `overRepository` runs format.read, the tree read, and the stamp; then `overTree` — applyTree/advanceTree, then carry and writeBasis. Successfully resolving the earlier commit passes only between parts of this read, never taken from scope.since, never entering TreeReading, never stored in the basis. A stamp that differs from the scope's basis keeps the earlier separate verification and rebuild on an unreachable stamp. `ensureFreshMirror` calls readTree without scope and never uses this cut. Holdings and every write/CAS point never changed.

## Measurement

Apple M2 Max, 12 cores, 32 GB, macOS 26.0.1, Bun 1.4.4. Two files, each a separate testbed with `--no-isolate --parallel=1`. A1 B1 A2 B2 — adjacent runs with the exact return of own source to the earlier body for A, no stash/reset/checkout copy. Test code identical across all four runs: the existing moved-HEAD contract before A1 is supplemented with the live mirror stamp, repair delta, and a differing unreachable stamp; no new worlds, loops, or tests added for the counter.

| File / site | A1 | B1 | A2 | B2 |
|---|---:|---:|---:|---:|
| freshnessMatrix: all git | 147 | 146 | 147 | 146 |
| freshnessMatrix: commit verifications | 14 | 13 | 14 | 13 |
| CPU of those verifications, ms | 110.341 | 100.379 | 119.498 | 124.392 |
| File and children CPU, s | 3.252 | 3.048 | 3.421 | 3.586 |
| topologySync: all git | 141 | 135 | 143 | 126 |
| topologySync: full-oid verifications under refresh | 3 | 2 | 4 | 2 |
| topologySync: repeat of the same oid inside one refresh root | 1 | 0 | 2 | 0 |
| File and children CPU, s | 5.561 | 5.081 | 5.995 | 6.275 |

The removed duplicate in freshnessMatrix cost 8.365/9.584 ms CPU in A1/A2; in topologySync — 8.318/14.902 ms (in A2 two commands together). No duplicates in B. The remaining topology difference is watcher passes, not the cut's result. Load in these runs' readings swung roughly 31 to 49; A1 waited 260 s on slots. These samples prove no total CPU speedup: in B2 the file's CPU grew. The measured claim is minus one git per qualifying read, not a total speedup figure.

Preload with argv, cwd, Effect root, and process CPU: `~/.tagma-dev/scratch/01a17ad9-64cb-7877-b99c-2baf36b8a082/git-sites-cpu.ts`. Raw JSONL and `commit-sites.ts`: `~/.tagma-dev/scratch/01a17b0f-3179-7b33-b757-80acce88f8f3/`, `refresh-A1/B1/A2/B2`, `topology-A1/B1/A2/B2` subcatalogs. Every git of these two files gave measured CPU; this attribution never derives arbitrary JS work's cost from one process.

## Why topology was not cut

Two open syncs are split by fill/advance and different repository holds. Holding the repository across graph steps would block parallel opens; lanes.itest.ts requires two opens to reach the held format step together while the main copy answers. In refresh, readTopology stands before the repository/tree hold, while siblings.flush and recovery.restore before sync can change shadow. No snapshots passed between those points.

Across 13 read for-each-ref sites of the graph, no pair with the same repo/cwd/hold and only prefixes differing was found: code refs and shadow refs are different repositories; shadow heads+tracking already merged into readTopology, and remote.readSides carry different reachability conditions, as do twin-holds/holders/recovery-holders. A standalone ServingSwitch.branches reads twins once, renameBranch reads before writing, rollback — after. The child-tree `rev-parse --abbrev-ref HEAD` stayed: a neighboring cwd never replaces its validation.

Even with a single branch, `--merged HEAD` keeps a separate refusal: a synthetic refs/heads/main pointing at a tree oid passes the initial for-each-ref (exit 0), while the merged query answers exit 129: `object ... is a tree, not a commit` and `option 'merged' must point to a commit`. That probe was never a product test; its fixture removed after the reading.

## Verification

On the final source, seeds 1/2/3 each passed separately for `graph/tree/freshness.itest.ts`, `graph/tree/freshnessMatrix.itest.ts`, and `composition/testing/graph/serving/topologySync.itest.ts`: 9 file runs / 36 bodies. Package `bun run typecheck` from apps/tagma/server green. The first typecheck caught an intermediate peer red `terminals.worker.ts: Property input does not exist on type Held`; the holder fixed it, rerun green. `git diff --check` over both own paths green. Full integration and check:change never ran on the launching agent's instruction: another holder's full run was on the machine. Server and browser never started.

The independent [[01a17b20-3fb8-7b9f-b8c5-c78a2adce122|reviewer]] on gpt-6.1-sol xhigh, without starts, found no findings and reconciled the raw A/B. Commit `5d4ec2424a` carries both freshness paths; the commit step reformatted only an expect expression in a test. This cut's task is done; double topology reads and a joint integration/check:change are not claimed resolved by this commit.
