---
id: 01a14a30-6ea3-7e20-90dd-8b716db88451
title: "rolloutDrill: isolate the graph pool recreation so later tests do not depend on order"
ord: 18
tags: ["task"]
fields:
  {
    "holder": "tagma:01a149fa-30c4-741e-ac91-360dfb76dfdc",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1487f-0761-743a-89fe-98e48f3e8091
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/rolloutDrill.stest.ts
---
Cause: swapping `runtime.pool` did not update the core closures holding the closed pool. The mirror case is now it.live with its own home/project and Scope: the first runtime closes whole, after the mirror's deletion a second one is created with all its owners; the file's shared world is unchanged. The case stands before later births: before the fix a narrow run gave graph-pool closed, after — 2/2, the whole file 18/18; sample test/layers — 9622 ms wall with ceiling 60 s. A sweep-fixture timeout found in the full run was removed by bulk-seeding a minimal 2001 records instead of sequential bornThread; ensuring clears the setting and lines. `bun run tagma:typecheck` — exit 0, Sol xhigh review with no findings. The work already landed in shared commit `7840e5210a`; a repeated submit_work returned nothing to commit. The shared commit's subject lacks the task id; no new or empty commit was created. The wide port of [[8f3e8091|the test catalog]] stays open with no holder.
