---
id: 01a11979-c599-7a1e-b168-8b47d6644083
title: Keep cwd when choosing a project in the CLI
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11979-16fc-76b4-988c-85531ac4d6bc",
    "status": "done"
  }
---
Fix the lost checkout on `tagma op … --project`: find out the owners of project and graph resolution, reproduce the selection of main instead of the worktree, and keep the call site in the original CLI request. The check must show a write only to the graph of the current worktree and preservation of an explicit choice of another project; the result is a commit and an answer to the reflection.
