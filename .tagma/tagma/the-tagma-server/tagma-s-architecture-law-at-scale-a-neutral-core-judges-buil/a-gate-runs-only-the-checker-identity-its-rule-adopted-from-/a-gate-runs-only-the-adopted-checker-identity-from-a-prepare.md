---
id: 01a0f4ab-e316-7f2b-bdee-e44c081cfd4b
title: A gate runs only the adopted checker identity from a prepared environment and fails closed without one
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f57f-61b0-726a-985d-ea2398af5259",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f476-04f3-7b7d-8ecc-b27fb2965d21
  - kind: waits-on
    to: 01a0f4ab-e2f0-7606-910e-f31b53727148
  - kind: waits-on
    to: 01a0f4ab-e311-7a99-af0d-be9c544301b1
---
A gate runs only the checker identity its rule adopted, from a prepared environment built from the descriptor's declared closure, and fails closed when it cannot be prepared ([[b2965d21]] — first-phase minimum: declared `pins`, `packages`, `runtime`).

**Class:** complex — `claude-opus-5-5` high.

**Target:** identity digest over the pinned blobs from git, the packages' `name@version+integrity` from the lockfile, the runtime; a prepared environment per digest in enforcement's store, leased per judgement, evicted only unleased under a byte budget derived from the disk; a checkout whose closure diverges reads `pending re-adoption` and the gate keeps the adopted environment; an unpreparable environment is `inspection-failed: checker not prepared`.

**File scope:** a new `apps/tagma/server/src/enforcement/checkers/**`; `enforcement/programs/**`; `enforcement/workers/programWorkdirs.ts`; the adoption record's checker digest field.

**Acceptance:** [[b2965d21]] §7; typecheck; tests.

**Waits on:** the contract 2 task, the adoption task.

**Reviewers:** Muse lenses (security of executed bytes; disk bounds), `claude-opus-5-5` xhigh, `gpt-6-astra` xhigh (law-astra).
