---
id: 01a1941f-f2bb-77f3-9717-654c6c7bd0aa
title: Resolve remaining parser and declaration mismatches at landing
ord: 170
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19421-dd94-70a8-8803-d52a38bf16bc",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a18679-d5f7-7d63-a817-4658b089d651
  - kind: relates
    to: 01a18745-8035-7554-91b6-fa5bb14d1306
  - kind: relates
    to: 01a190e5-ae6b-761d-9a49-aac323bfdacb
  - kind: relates
    to: 01a193e9-34c4-7d24-9748-f262c61ffd40
  - kind: relates
    to: 01a19409-a00d-7d3e-a0e8-5bbc91b82447
---
Fixed in 5ede20546a (`@runlith/code-facts` placement, red→green through native submit_work in `dependencyMembers.itest.ts`): a bare imported type with no receiver (`Format` re-exported by another published entry than the one a peer extends) now starts the placement walk from its own import; the walk follows class/interface heritage and `export *` chains; a relative specifier resolves through TypeScript so `./x.js` reaches `x.d.ts`.

Findings per report:
- 91b82447 — fixed: the refused name was a same-named export in a file the importer never reaches; placement never widened for a receiver-less identifier.
- 23bfdacb — `writes`, `run`, `session` in `protocol/steps.ts` (at ee2f56306) now place: `writes` is a member inherited through `extends Context.Service<…>()`. Still unplaced: `at` in `native-harness/runs/transitionStore.ts` (at 3251183d8), whose receiver is a drizzle `.get()` result that stays `unknown` after six rounds and 64 files — a bounded-inference limit inside the conservative by-name contract, not a resolution error. Child 71014c95 (`ProgramUnit.returning`) was not examined.
- c61ffd40 — cause: the sample was created by a bash command (`harness/src/copy.ts`) and then edited four times; the selected slice dropped the copied base and parsed as invalid TypeScript. 0c0a24a26c (task 7ca68b8b), later than the reporting server, refuses such a base `lines-held` before slicing.
- b089d651 — reproduced on current code: `dependencyImportsOf` (the whole-importer probe) throws `UnsupportedSource` for `src/tsconfig.json` extending `@tsconfig/svelte`, installed only under `targets/upstream/vite-plugin/node_modules`. `whole` skips line slicing, not the whole-importer dependency check; reading a config without its extends is a rejected alternative (a71f4364). Changing that is a policy choice, not a resolution fix.
- b14d1306 — not repeated; 50f5e5bd passed the native merge scenario and the original conditions remain unknown.