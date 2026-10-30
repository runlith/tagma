---
id: 01a18e91-babe-75db-a337-6f5e14876856
title: Track regular-source and symlink transitions in declaration changes
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18e91-0057-7f4b-85b6-a35adafffddb",
    "status": "done"
  }
---
The declaration index drops a tree difference when either side is a symlink (`checks/law/declarations/index.ts:175–177`). Prove transitions in both directions through incremental inspection, treating each non-regular side as absent source code.