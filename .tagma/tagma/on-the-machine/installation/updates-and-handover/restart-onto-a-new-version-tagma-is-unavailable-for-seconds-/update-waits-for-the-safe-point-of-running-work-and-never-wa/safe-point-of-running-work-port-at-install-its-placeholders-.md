---
id: 01a126b9-6a5d-780b-8049-4226c46d743d
title: "Safe point of running work: port at install, its placeholders and run pause for update"
ord: 1
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79e9959a4005
  - kind: waits-on
    to: 01a126b9-6a5d-780b-8049-42259ae1db7b
---
The safe-point port in `installation/contract/service` and its placeholders — operation calls for every door, native harness, landing, worktrees, builds, speech; door closing waits for accepted operations; a run stopped by an update is never judged by the abandoned-run deadline; a window call tells "not accepted" from "outcome unknown" apart. Start with `installation/process/succession.ts`, `packages/agent/src/thread/run/ThreadRunReaper.ts`, `cli/verbs/mcpServe.ts`. Done when spec checks pass.
