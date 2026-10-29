---
id: 01a0cab4-a1c1-7916-8e64-01b0799b9879
title: "The removed settle mutation still has callers: dead path in TreeScreen and a red typecheck"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0cabe-17dd-7be2-91ad-9d1e1a516efb",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/BlocksRepo.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/StatusMenuItems.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/TreeScreen.svelte.ts
---
Commit `8f6c693d` removed the `settle` mutation from `BlocksRepo` (its member list — tree/block/titles/edges/refs/diff plus sixteen mutations — names no `settle`), but two callers still stand: `TreeScreen.settle` (`TreeScreen.svelte.ts:428-429`) awaits `this.repo.settle.run(...)`, and `StatusMenuItems.svelte:22` falls through to `store.settle(block.name)`. The fall-through is unreachable — `StatusAction` (`status.ts:73-75`) is `{set}` plus five named ops, all handled above the `else` — so the path is dead at runtime. It is not dead to the typechecker: `Repo.define` types the repository as `Service&lt;Built&lt;TDescriptors&gt;&gt;` (`packages/query/src/repo.ts:311-329`), an exact map over the declared members, so `this.repo.settle` on a memberless key is a static error and the app typecheck is red at HEAD. (`ProviderAuthPanel.svelte.test.ts` defines its own local `settle` helper; unrelated.)

The repair is deletion, not restoration: the server-side op is gone with the commit. Remove `TreeScreen.settle` and the `else` arm (narrowing the fall-through to an exhaustive check if one is wanted). Done when the app typecheck is green and no reference to the removed mutation stands.