---
id: 01a12329-0334-71bc-ae50-30aec8279893
title: Fit the child-birth and external caller checks into their test layers' budgets
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12307-315a-7ac2-8df7-255b44e179d5",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12306-efba-7a0e-94d7-05eed6340847
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/http/threadChildDoor.stest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/externalCaller.stest.ts
---
The assembled-server checks moved to `.stest.ts` byte-identical; all 11 contracts kept. `doorWorld` already held one world per file and in-process HTTP; pre-first-test measurement showed 2917 ms CPU for child-door and 2807 ms for external-caller, including module loading and boot. Samples of `bun test --parallel=2` from `apps/tagma/server`: the lead's original measurement — 9548/12267 ms CPU; a repeat before the move — 5980/7748 ms CPU and 4314/4398 ms wall; after — 7277/9637 ms CPU and 11290/11622 ms wall with system-ceiling 60000 ms, 11 pass. Number order: child-door/external-caller. This is a layer change, not a speedup; during the post-move measurement HEAD and foreign sources changed, so the comparison proves no speed change. The Tagma server was not restarted.
