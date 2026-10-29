---
id: 01a12cad-d4a0-7c0a-94ad-043222e93d0f
title: "A binary path another session also changed is disputed: submit_work refuses lines-held instead of silently landing it whole"
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c86-94f7-747f-9d9d-8b4c7b522a9e",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a10c5b-4903-7e93-bf59-f4f8da1db44a
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/fold.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/tree.ts
---
The operator's decision: files that are not text lines (binary, symlink), written by the session's tool or command, belong to it and land whole; another session's uncommitted edit of the same binary file makes the path disputed — a refusal naming the holder.

Cross-checked with code: `produces` deleted, commands write lines for binary files too, and for symlinks (mode 120000), and submit_work lands them. The defect is the landing plan (`prepared/tree.ts` `planPath`): an unreadable-as-text path landed whole, while others' holders were only listed in `carried`; the `wholeFile` judgement additionally gave the binary path to one last writer, and the previous session's line left with the landing.

Done when: the whole-file judgement names as holders all writers of the version chain from HEAD to the working file; landing such a path without `whole` refuses `lines-held` with their names, with `whole` — lands and names them in `carried`; itest in `commandLanding.itest.ts`.
