---
id: 01a0ca97-13aa-7007-81c4-d05194983e4d
title: Write the claims of the vocabulary every caller speaks
ord: 204
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0caa8-26f4-7202-b67b-40816291a5b7",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca94-63c5-789a-9e91-c36105042d40
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: apps/tagma/server/src/protocol
---
Read `apps/tagma/server/src/protocol/` — the flat tables first, then `operations/` and `harness/`. `protocol/tags/` belongs to [[8ec9c71c]] and `protocol/settings.ts` to [[ec2b42ac]]; read them for context and write no claim over them here.

Write the claims of [[19aec648]], [[fe6b3580]] and [[79d2a545]]: what a declaration in this tree is allowed to know, what a family table guarantees about its ids, what an adapter says about a foreign CLI and what it deliberately leaves to the runtime, and which of these modules cross to a browser and what that costs them. The module claim [[05042d40]] already states that no entry names a transport and that every declaration is bound to exactly one body — do not restate either; qualify or reference them.

Done when every claim is written from the code and verified after a reading of all its sources, every symbol anchor resolves, `run_doctor` over these paths stands clean, and a review leaves no FALSE, OVERBROAD or UNSUPPORTED unresolved. Precision to match: [[d1caad35]] and [[249ce587]].