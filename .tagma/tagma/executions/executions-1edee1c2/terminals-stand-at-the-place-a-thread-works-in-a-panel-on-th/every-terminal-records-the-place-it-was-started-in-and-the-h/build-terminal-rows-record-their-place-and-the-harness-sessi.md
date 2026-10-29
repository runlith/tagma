---
id: 01a0d56a-997f-7947-ac33-d3832e287078
title: "Build: terminal rows record their place and the harness session they serve"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d56b-2f2a-7fd0-a3d6-ebecc3737aed",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d56a-9853-79ac-9ff6-fa60e8d26502
---
Build [[e8d26502]] whole: migration and backfill, the start road writing `root_id` and `launched_for`, the harness launch passing its thread, `TerminalView` and the operation texts. Start at `terminals/Terminals.ts` (acceptance) and `db/terminals.ts`. Done when its acceptance holds and the server's terminal suites pass.