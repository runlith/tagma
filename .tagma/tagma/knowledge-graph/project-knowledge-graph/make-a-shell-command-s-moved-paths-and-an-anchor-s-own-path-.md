---
id: 01a0c88a-e5d8-72b8-a7fc-bcd0327289e6
title: Make a shell command's moved paths and an anchor's own path touches on the law road
ord: 151
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0c87c-9b36-7d22-9b36-467719851665
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/orientation/Touches.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/touchRule.ts
---
The touch road answers the workspace file tools — `read`, `edit`, `write` — and nothing else, so a session that moves a file with a shell command, or anchors a block onto a path, never hears the law of the region that path is in. Both are touches by the meaning [[19851665]] accepted; only the file tools were built.

Where to start: `touchRule` names the tools it answers for in `TOUCHING_TOOLS`, and `Touches.record` already resolves a place to its regions through [[994c45a7]]. A shell command's moved paths are recorded by the change record's observed-moves road, which runs after the command; an anchor names its path in the operation's own arguments. Neither has a window, so both answer for the whole file.

Done when a session that moves a file under a region with a command, and one that anchors a block onto a path under a region, each receive that region's rules once, with the same ledger the file tools use — proven by a test beside `touchRule.test.ts`.