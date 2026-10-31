---
id: 01a147e0-e5d0-7311-ae81-30d9cc055347
title: "Enforcement integration tests exceed the 8 s CPU budget: copiedLaw, modules, inspectionFailed, triggers, enforceWrite — speed up or move to their own layer"
ord: 49
tags: ["task"]
fields:
  {
    "holder": "tagma:01a149fa-30c4-741e-ac91-360dfb76dfdc",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/enforcement/copiedLaw.stest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/enforcement/enforceFixture.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/enforcement/inspectionFailed.stest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/enforcement/moduleLaw.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/enforcement/modules.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/enforcement/moduleStale.itest.ts
---
The cause is checks of assembled owners and several independent contracts in one integration file. copiedLaw (full ServerRuntime with HTTP/native doors) and inspectionFailed (graph/enforcement/landing with worker refusals) moved to the system layer; modules stayed in integration and split into cards, debt accounting and prepared-change freshness. Three independent resolver/importer checks run as separate short scenarios with no intermediate recovery commits. The first enforceFixture world opens in beforeAll, later cases from a copy. Samples of 2026-10-17 per test/layers.ts: modules 6,303 ms CPU, moduleLaw 6,668, moduleStale 7,698, triggers 6,922, enforceWrite 6,163; copiedLaw 50,533 ms wall, inspectionFailed 24,679. All original scenarios kept and passed, seven old fixture consumers — 51/51; `bun run tagma:typecheck` — exit 0 before the file split. Finding Sol xhigh on wrongly moving modules to system fixed by splitting inside integration; budgets unchanged.
