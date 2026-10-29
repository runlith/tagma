---
id: 01a0ca97-13de-7dcb-b4a6-82ebdec93933
title: Write the claims of the files beside the database
ord: 213
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0cac3-0c08-77b4-90bc-1564807426e0",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca94-63c5-789a-9e91-c36105042d40
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: apps/tagma/server/src/files
---
Read `apps/tagma/server/src/files/` whole. Two of its concerns already have owners: [[fc9c26d8]] holds the rollout and eviction files, and [[a115687f]] holds the serve log — read both and write nothing that repeats them.

Write the claims of [[298493d0]], [[84e7cf4e]] and [[372b147b]]: what the mirror guarantees between rows and files and in which direction, what a rebuild and a repair each do to a divergence, what a block file's encoding preserves, what the change record can attribute and what it can only report as unexplained, what a discharge removes and on what proof, and what a conflict is answered with. `.tagma` belongs to the graph owner — say what that means for anything here that writes it.

Done when every claim is written from the code and verified after a reading of all its sources, every symbol anchor resolves, `run_doctor` over these paths stands clean, and a review leaves no FALSE, OVERBROAD or UNSUPPORTED unresolved. Precision to match: [[d1caad35]] and [[249ce587]].