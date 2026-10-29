---
id: 01a13236-64ca-761e-999f-75e717872cd0
title: "submit_work lands a move as a pair: the deletion source goes with the destination, the command's unattributed paths are not cut"
ord: 17
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1321e-0f91-767d-96d0-1c06c1dbc31b",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1321d-89bb-71ad-9fc2-e79213a6bba3
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/carriers.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/commandRows.ts
---
A session's file move lands in one commit — the deletion source together with the destination — however made: `git mv`, `rename`, a command; the large command's unattributed paths stay available for `paths`.

Roots, confirmed on the mask-boundary (git mv of 766 files amid others' commands):
- The landing built the tree from the base and the session's paths; a source the session did not hold stayed in the judged tree as an old copy — 083d37f1 judged its dead imports (74 crossings). The move's pair was visible only to read_changes (from the full git status), not to the landing.
- A deletion without mtime is judged by the command window and almost always falls into overlap, while the move pair was built from only two attributed sides: the destination landed without the deletion.
- The session's saved unattributed-paths list was cut to 256: a large command's paths silently dropped out, and `paths` answered "named no file this session holds".

Done when system tests through submit_work show pair-landing of a move for git mv with an edit, a staged move by the old path, and via taking+whole, a rename-tool move with `paths` on the destination, a command with overlap deletion, and 300 unattributed paths by directory; the change landed.
