---
id: 01a132fb-f271-71b6-a5fa-df0c27cfd1e3
title: "Small landing pays for every managed git: cut the batch cost at the road owner"
ord: 19
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13517-7ef9-7bee-86c8-94a3dc31a7f1",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/commit-steps/declaration.ts
  - kind: file
    ref: apps/tagma/server/src/executions/commands/admittedGit.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/commitTrees.ts
---
After the [[b32630c3|small-landing court repair]] the final native sample on 6024 files and six changed paths still shows 32 admittedCommand.start and 36 ShadowGit.answer: prepare 948 ms, shape 519 ms, execute 1838 ms; elapsed sums of the answer/start/wait names — 1237/526/617 ms, nested names don't add up and aren't CPU. Break down admission, host transport, git launch and exit wait at executions/Git, then cut repeated reads and process roundtrips at these owners: prepare already knows the shared git dir, the steps declaration reads via ls-tree + cat-file, the private index is assembled and re-read by several commands. This is a separate batch/object-session device, not a consumer cache in landing. Keep typed admission refusals, identity/ref/HEAD rechecks, command rules, cancellation and the full committed context of hooks. Proof — matched corpus/delta with native producer counts, elapsed and CPU separately, plus refusal/race/cleanup contracts. The source polygon and exact traces stay in the parent task's scratch.

## Outcome

Deliveries `d17c9d1c35` and `17574b9100`. The checkout layout (git dir, index, hooks, operation files) and HEAD are read by the kit in one `rev-parse` at landing start, commit_checkout and pull ([[064d4461|layout note]]); the publish branch comes from the same read as the base; the steps declaration — by object session (`treeBlobAt`); `admittedWatch` takes the stdout/stderr end from the settled summary and doesn't read the empty stream and confirming window (the invariant is pinned in host conformance).

One managed git broken down (after trace, elapsed): start ≈15 ms — scope.resolve 2.7, prepare 1.0, acquire 1.4, three store writes (reserve 2.6, dispatch 0.6, record 2.1) and control roundtrip 4.5 (Host.Start 2–4 ms); wait ≈20 ms, of it git itself with exit ≈17 (a direct spawn of the same git 10–15); observe+console ≈2 ms.

Polygon `/var/folders/87/cmcr9wbs5yqcbthnzgqp7lh80000gn/T/tagma-gitbatch` (6024 files, 6 paths, two gates, formatter step), its own `tagma:try`, keepOneTraceIn=1; traces and scripts — the performer thread's scratch.

Warm landings, medians (before n=5, after n=6), elapsed and CPU separately:

| | Before | After |
| --- | ---: | ---: |
| managed gits per landing | 28 | 16 |
| admittedCommand.start | 32 | 20 |
| Terminals.bytes | 31–54 | 12 |
| console elapsed sum, ms | 159–248 | 17–21 |
| submit_work execute, ms | 1743 | 1062 |
| prepared.prepare, ms | 1030 | 617 |
| prepared.shape, ms | 620 | 393 |
| CLI wall, ms | 2248 | 1525 |
| server CPU per landing (ps), ms | 1250 | 740 |

Builds differ (before — a dirty tree with other sessions' work, after — clean `17574b9100`), machine load uncontrolled; this doesn't isolate the build's causal CPU share, counts are deterministic. A `rule-violated` gate refusal on a new node:fs line verified on the after build, HEAD didn't move, the polygon is clean.

Not done and unproven: the three store writes and repeated target resolution per managed git stay (these are admission guarantees); merge worktree and graph publication still read the layout in several places of their act; `submit-changed` and `commit-steps-candidates` compute the base→tree diff twice (a shared diff would make every landing pay numstat); two concurrent Retirer passes — [[9d137830|separate task]]. Windows unverified.
