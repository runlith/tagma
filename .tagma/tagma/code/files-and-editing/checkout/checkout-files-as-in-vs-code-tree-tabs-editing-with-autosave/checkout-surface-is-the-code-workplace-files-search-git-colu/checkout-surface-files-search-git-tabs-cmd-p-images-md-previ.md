---
id: 01a11808-74cb-7b06-9e37-73311f61b3ee
title: "Checkout surface: Files | Search | Git, tabs, Cmd+P, images, md preview, path opening (worktree file-manager)"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a117dd-98e5-7df2-86cb-e3fbb51edd1b
  - kind: waits-on
    to: 01a11808-74cb-7b06-9e37-732e77e5cfa2
  - kind: waits-on
    to: 01a11808-74cb-7b06-9e37-73307dc50d04
---
Build [[b51edd1b]] in the `file-manager` worktree — in read mode. Sonnet and Opus write the UI (73ef5889), the token standard is 55b5437b.

**Done when:** the spec acceptance passes; the terminal stub is deleted; typecheck, tests, and inspections green; the change landed. Manual operator check is not a completion condition.
