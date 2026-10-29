---
id: 01a0ca97-8704-7233-a6b4-7b3713ff85f5
title: Drop the dead trimDiff export or put it to use
ord: 23
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
`trimDiff` is exported from `packages/agent-tools/src/edit.ts` with no importer anywhere in the repository and no re-export from the package index. Either drop the dead export or re-export it where it is meant to be used, then run the package's tests.