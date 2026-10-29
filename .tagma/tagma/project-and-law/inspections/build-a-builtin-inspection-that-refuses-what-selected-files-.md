---
id: 01a0d83f-5759-73d6-b18b-d42cbfd17d2c
title: "Build: a builtin inspection that refuses what selected files load at runtime, followed through relative imports and workspace packages"
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d838-35bd-7f79-89ac-e71d644894c4",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0d4db-9d34-7461-807d-8775f5648cf9
  - kind: relates
    to: 01a0d82d-4392-70ce-a335-67c8e8510b18
sources:
  - kind: file
    ref: apps/tagma/inspection/src/node/loads.ts
  - kind: file
    ref: apps/tagma/inspection/src/packs/js/loads/declaration.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/inspecting.ts
  - kind: file
    ref: packages/code-facts/src/languages/js/workspace.ts
---
A second builtin for the enforcement engine ([[805446cf]], [[bbddbda9]]): files a rule selects must not load at runtime a refused specifier, followed transitively through relative imports and workspace packages resolved by their `package.json` `exports` maps. Type-only imports are erased; lazy `import()` is not followed. `allows` names package subpaths allowed under a refused root. It is the law [[e8510b18]] needs held — the server's low floors load no model client — and it replaces the kind of law `package-boundary`'s `browserEdges` holds in a test nothing runs, without importing it.

**Do:**
1. The builtin in `@tagma/inspection`: parameters, description, limitations and unblock words in the vocabulary door; the reading in the Node door. It stays neutral: no project's opinion in the engine.
2. What `code-facts` lacks for it: a read mode that leaves `import()` out, and a tree that can name the texts a reading still needs.
3. What the engine lacks for it: a worker reads from the git tree beyond `base` (workspace packages), fetching texts as the reading reaches them, memoised by blob id as `direction` is.
4. Measure it on runlith, state its reach honestly and what a landing re-reads; it stands at landing only if it fits the landing budget.
5. The runlith rule under the Tagma server module ([[05042d40]]), tried with `try_inspection` and enforced at gate; the edges `speed-imports` has not cut yet are debt owned by [[e8510b18]].

**Done when:**
- a violation names its source file, the chain to the refused specifier and the first import line, under a fingerprint stable across unrelated edits (from-file × refused entry);
- the measured time on runlith is named, with the run point it fits;
- the rule stands enforced, and one Opus reviewer's findings are answered;
- claims over the builtin and the engine change are written from the code and verified.

**Divergence: enforcement stands open.** The installed server is a release cut before `loads` existed, and no release is cut while build-command-inspections' work is unlanded (the parent's word). The rule is written, unenforced: [[0d2c66a9]]. The architecture thread runs `try_inspection` and `enforce_rule` on it after the operator cuts a release; at d2e1d458c7 its inspection finds nothing over the reach, so it starts with no debt.
