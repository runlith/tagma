---
id: 01a0f52c-a298-723d-9075-bfaf414576c6
title: Resolve system creation defaults and command choices from installed catalog profiles
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f537-771f-7a78-bbca-9d01a9e76961",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f483-46bd-7bbf-9507-57a43087c3ed
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/graph/vocabulary/activation.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/graph/vocabulary/defaults.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/graph/vocabulary/defaults.test.ts
  - kind: file
    ref: apps/tagma/server/src/graph/work/filedReflections.itest.ts
---
Complete the creation-default and command part of [[3087c3ed]] through real graph consumers, preserving the installed profile when an upgrade is blocked. Coordinate profile schema and shipped definitions with tag-catalogs, behaviour bindings with tag-contracts, and writable registration with tag-step-0. Reflection filing stays in Tagma's graph and amendment/view behaviour comes from each selected type's contract. Core consumers resolve permanent type ids, never catalog-tag literals or a current-binary fallback. Prove default selection, an alternative local type with the same contract, typed refusal for invalid configuration, and unchanged target graph through public fixture operations. This task owns backend selection and consumers; catalog presentation remains with tag-catalogs. Sol high implements under [[6ccec00a]].

Landed as 8cc9719e8e (19 paths; `tags/profile.ts` arrived through the parallel catalog landing): typecheck exit 0; `defaults.itest.ts` 6 pass, `filedReflections.itest.ts` 6 pass, `proposals/filing.itest.ts` 9 pass, `defaults.test.ts` 1 pass, CPU layer limits held. Standing claims reconciled and verified. Blocked-upgrade retention proved by `activation.itest.ts` ("an automatic upgrade the adopted law refuses keeps the previous release active", lines 75-106): with a `law-adopted` blocked candidate the creation default stays the previous profile's `board`, both catalogs file `upgrade-blocked`, and after dropping the adoption the upgrade installs with the `view` default — reported `bun test activation.itest.ts`: 3 pass, 0 fail, 16 expects, 2.35 s, commit f44c826c6e.