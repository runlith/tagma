---
id: 01a11808-74cb-7b06-9e37-73307dc50d04
title: Git tab and thread stage on the code-editor kit, diff minimap removed (worktree file-manager)
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a117dd-98e5-7df2-86cb-e3f7db56abc2
  - kind: waits-on
    to: 01a11808-74cb-7b06-9e37-732f162f719e
---
Build [[db56abc2]] in the `file-manager` worktree. UI by Sonnet and Opus (73ef5889), the standard tokens by 55b5437b.

**Done when:** the spec acceptance passes; #rule 9d65d54f is lifted; typecheck, tests, and inspections are green; the change is committed. The operator looking at a diff in the browser is not a completion condition.
