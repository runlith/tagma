---
id: 01a0f776-71a8-7060-87f3-8d4fa523aa76
title: Lay out the inspection packs as `architecture` and `js`, read a built package's output from its manifest, and prove core neutrality on two unrelated fixture projects
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f772-cb33-7c36-86bf-7654612ef2ef",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f476-04d1-75cd-af52-c567fd53d2cb
---
Lay out Tagma's first-party inspection packs as [[fd53d2cb]] §4 names them and prove the core's neutrality ([[fd53d2cb]] §7; phase "now" of [[8fe9d0a8]]; [[cdf2a89f]] step 6 remainder).

**Already landed by [[8dc37737]] (fcc0c1a80b):** the four unused builtins, the `tagma` pack, their `checks/*` copies and `bench:*` scripts; `platforms.built` as a list of package names.

**This task:**
- Packs `repository` → `architecture` (`src/packs/architecture`) and `typescript` → `js` (`src/packs/js`), ids and manifests renamed; the composition (`builtins.ts`, `builtins.node.ts`) is the one place naming packs; `core/` names none.
- `platforms.built`: the output directory of a built package is read from the package's own manifest (the directories its absent declared doors point into), not a wired `dist`.
- Tagma-only helpers out of `core/` (`core/node/liveRule.ts`, reading `.tagma` block files, used only by the `modules` bench); dead benches that read deleted snapshots removed.
- A conformance test: two unrelated fixture projects with contradicting policies judged on the shipped catalog with no code change.
- Source audit of `core/` and the first-party packs; findings that are law still in force are reported, not removed.

**Not in scope:** the `effect` pack and the `reexports`, `swallowed-failures`, `call-services`, `names`, `modules`, `direction` builtins — enforced rules [[8183e6ef]], [[ea465bed]], [[4657a163]], [[6b3210c7]], [[083d37f1]] and the four `direction` rules still carry them; their removal follows re-adoption (steps 4, 5, 8). `src/runners/**`, `packages/code-facts`, `enforcement/` adoption.

**Acceptance:** `read_inspections` shows packs `js`, `effect`, `architecture`; the conformance test passes; `check_rules` over the change finds no new violation; typecheck of `@tagma/inspection` and the server; inspection unit tests.
