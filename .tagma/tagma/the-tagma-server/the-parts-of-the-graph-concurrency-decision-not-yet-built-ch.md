---
id: 01a0efa4-b97c-737b-9210-9812d8909f86
title: "The parts of the graph concurrency decision not yet built: change-proportional refresh, in-process merge reading, no-op batch skip with stamping, topology probes off the permits, team trees in the committer lifecycle, and the promised telemetry"
ord: 70
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
[[104a04c1]] was built in commits bbe6dfaef6, 93a9ec3bdc, c16682333f, 9cbffef249, a0d0ea3f81, b2f8125d04, 5cf91e7f77, b4f0c96e55, 5a67f3f374 and 0a0ef4218e. Its targets for reads, act guards, batching and machine-sized readers hold. The parts below were accepted there and are not yet built; each keeps that decision's reasoning, and the section named is its specification.

## Not built

1. **A refresh costs what changed, not the tree** (§4.5). Every refresh runs a whole-tree `git status --untracked-files=all` and a `rev-parse HEAD` under the repository permit, even when the watcher named the paths that moved. Target: import the watcher's named paths, and keep the whole-tree status for rescan recovery (a watcher overflow, the baseline).
2. **The mid-merge reading is in process** (§4.5). `unmergedTracker` still runs `ls-files --unmerged` whenever the index file's identity moved, which is one git process in front of an act after every foreign index write. Target: read the index's stage bits in process.
3. **A batch that changes nothing commits nothing, and a published batch stamps the mirror** (§4.3, §11). Nothing skips a batch whose captured blobs equal the branch tip's, so a carry that races a publish can mint an empty-delta commit. The mirror's stamp advances only at the next refresh, which then diffs over Tagma's own batches. Target: a per-path blob memory, invalidated when the branch tip is not the last published commit, and a stamp written after each batch without putting the store inside the repository permit.
4. **Topology reads outside the permits** (§4.1 phase 1). `readTopology` runs three `for-each-ref` processes, not the promised two. When a rewrite is due, `syncTopology` repeats its branch probes (merge-base, rev-list per candidate) while holding the repository and tree permits. Target: take every probe in the outside reading and keep only the rewrite under the permits.
5. **Team trees join the committer lifecycle** (§4.3). Team storage keeps its own `treeCommits` with the quiet window. A refresh or baseline hands it no dirt, so an auto-policy team tree reopened after a crash stays dirty until the next act or `sync_graph`, and retirement does not flush it. Target: team dirt found by a refresh or at baseline arms its committer, and retirement flushes it.
6. **Observability** (§17). There is no `TreeCommitter.capture` span with bytes and process counts, no per-phase durations on `FreshnessGate.refresh`, and no counters for successful reader opens or bulk-reserve waits on `PoolState`.

## Divergences kept

- **An idle store keeps one reader** where §4.4 said every reader leaves. The reason is that the next point read after a quiet minute would otherwise pay a process start. [[f413c2ee]] states it.
- **A stealth or plain tree's batch commit runs no hooks**, because `fast-import` runs none. The per-act `git commit` it replaced ran the shadow repository's hooks. No hook is installed in a shadow repository by Tagma.

## Later slices, unchanged from §9

- A CPU budget for agent command work derived from cores.
- A restart that hands running agent runs to its successor.
- Separate writers per database, where measurement shows a need.
