---
id: 01a0d85d-a245-788d-90f6-2b1360f02834
title: "One submit_work starts up to 1675 git processes and takes 47.6 s: its reads of the tree are batched at the owner"
ord: 43
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d85e-3584-7c1d-9176-7b9fbb9c4c25",
    "status": "done"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/harness/submitWork.ts
    symbol: planPath
  - kind: symbol
    ref: packages/git/src/entries.ts
    symbol: blobAt
---
**Measured on 2026-09-25 by profile thread 01a0d842.**
- The server starts 43 git processes/s when busy: 12,934 `Git.result` in 300 s. 8,788 of them are `Git.blob` (`git show rev:path`), paired 1:1 with `WorkspaceChangeLog.evidenceOfPath`.
- One `submitWork.held` span had 1,675 direct children and took 47.6 s. Five calls took 104 s.
- Code: `harness/submitWork.ts#planPath`, `packages/git/src/entries.ts#blobAt`, `ThreadFiles.ts#weigh`.
- Task 963e8790 already batched the discharge's HEAD blob reads into one `cat-file` session, so that pattern exists.

**Do:** read the blobs a landing needs in one batched git session, and remove repeated reads of the same facts. The landing's result stays the same.

**Done when:**
- the git processes and the wall time of a landing of the same size are named before and after;
- the landing suites pass;
- the claims over the changed code are revised.