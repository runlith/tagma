---
id: 01a0ca97-13b6-79a8-892e-b6a63b56f6f5
title: Write the claims of a foreign CLI run as a thread of Tagma
ord: 206
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0caab-1b57-71a8-90c0-25411e5796ac",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca94-63c5-789a-9e91-c36105042d40
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: apps/tagma/server/src/harness/metadata
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/contract/service/sessions.ts
  - kind: file
    ref: apps/tagma/server/src/harness/protocol.ts
---
Read the `Harness*` files of `harness/`, with `wire.ts`, `protocol.ts`, `contract.ts`, `refusal.ts`, `harnessKeyboard.ts`, `harnessLaunch.ts`, `harnessFailure.ts`, `harnessFacet.ts`, `harnessTypes.ts`, `installedHarnesses.ts`, the two ask programs, and `metadata/` whole. `protocol/harness/` is the adapter table beneath this and belongs to [[79d2a545]].

Write the claims of [[6ca6b465]]: what a harness session IS to this product as against a native thread, what is observed rather than controlled, what a screen ask can and cannot settle, what of a CLI's own files Tagma reads and what it refuses to write, and what a permission decision means when the deciding CLI is not Tagma. Say plainly where a guarantee holds for one adapter and not for all six.

Done when every claim is written from the code and verified after a reading of all its sources, every symbol anchor resolves, `run_doctor` over these paths stands clean, and a review leaves no FALSE, OVERBROAD or UNSUPPORTED unresolved. Precision to match: [[d1caad35]] and [[249ce587]].