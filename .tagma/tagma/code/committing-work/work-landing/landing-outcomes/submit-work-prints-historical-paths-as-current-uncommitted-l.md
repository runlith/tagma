---
id: 01a12aec-8b6c-7cff-a54c-44fd2b224f32
title: submit_work prints historical paths as current uncommitted lines
ord: 4
tags: ["reflection"]
fields:
  {
    "actual": "723eca23c5 landed 10 paths but declared 16 paths uncommitted lines of this session, including five just-landed ones and the historical .witness-* and hostRestart.ts. The next read_changes answered holds 0 paths; git status showed only other writers' paths. In turns read_changes at holds 0 still marks the same five paths held.",
    "command": "submit_work(paths=[seven server stands, ExecutionStore.itest.ts, registry/launch.ts, store/ExecutionStore.ts]); then read_changes and git status --short",
    "expected": "The landing answer lists only paths where the session's current lines truly stayed out of the commit."
  }
---
