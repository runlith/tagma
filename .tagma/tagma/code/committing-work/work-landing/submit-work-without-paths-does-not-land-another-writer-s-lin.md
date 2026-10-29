---
id: 01a15e24-bbd2-794a-b3b6-65dbf8cd80c6
title: submit_work without paths does not land another writer's lines on a path where the session has no lines
ord: 133
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15e24-f83f-75b8-8a9e-ee5d8f7329d9",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15b30-1df1-7503-8b2d-9394b63be4a7
---
Per [[b63be4a7|foreign lines in landing]]: `pathsOfThread` returned unfinished records, while `prepared.heldPaths` mistook them for holding even after the session's lines were overwritten. Candidates now pass fresh Holdings; the implicit selection takes only paths with a holder from the session or `taking`, including unproven. A public regression through `record_write` and `submit_work` proved red→green: the peer's bytes of the overwritten path stay on disk, its HEAD unchanged, while its own second file lands. The HTTP suite moved to the system layer after the integration budget was exceeded. The independent review's single finding was confirmed and fixed: an unanswered candidate yields `walk-cut`; that boundary is also proved red→green through `PreparedChanges.prepare`. Result: 19 contracts passed, `bun run typecheck` checked 5217 files without errors.
