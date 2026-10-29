---
id: 01a0f262-56d2-75eb-bf30-6077fef04cdb
title: "Change record: revert_lines restores a thread's own uncommitted lines written in named runs, and answers per-run file facts for the rewind preview"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f262-e9e2-7cc8-b707-606a3b8b2f9d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f262-03db-7bb1-84f3-665d4263865b
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/lineWrites.ts
---
Build §4.5 and the file half of §4.4 in `apps/tagma/server/src/change-record`. `revert_lines { threadId, runIds }` restores only lines the record proves are still that session's, written in those runs, and not committed; a line overwritten since, held by another live session, or committed stays and is named in the answer. Never path-wide, never through `discard_checkout`. The file facts answer, per path, lines still own, lines committed and lines another session holds, for the same `{ threadId, runIds }`.

Start at the change-record rows (`runId`, `at`), the authorship proof behind `read_authorship`, and the `linesHeld` refusal pattern of `strip_comments`.

Done when acceptance criterion 8 holds in an integration test over a real checkout with two sessions writing one file.