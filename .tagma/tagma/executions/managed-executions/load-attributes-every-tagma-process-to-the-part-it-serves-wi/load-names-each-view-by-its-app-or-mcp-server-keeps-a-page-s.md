---
id: 01a1926d-1a3e-7562-b5e0-a0b016fa1af1
title: Load names each view by its app or MCP server, keeps a page's frames on that page, and proves the declaration chain end to end
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1924b-d758-7283-b8ce-1fd624316fc0",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1924a-436f-7b40-b6c1-d60a27dfcfc2
  - kind: implements
    to: 01a19236-e2ce-7b34-8015-7c0e70df78a3
sources:
  - kind: dir
    ref: apps/tagma/server/src/executions/load
  - kind: file
    ref: apps/tagma/app/src/lib/features/views/Frame.svelte
  - kind: file
    ref: apps/tagma/desktop/src/declared.ts
---
Gaps left by [[27dfcfc2]], against the spec's revised window declaration: a frame of a built-in page on another renderer is declared as `Origin` and its row cannot close the page; app views are named by app id rather than title; MCP App views carry no server, since every one shares the sandbox origin. Fix: the client names each view iframe with its identity, desktop main reads `frame.name` and declares a page's frames as that page, the server names app views by title and MCP views by server. Add the missing proofs: a feed test of `setParts` replacement and of the `others` demand union across readers and reopen, and the declaration chain through each seam's real door.