---
id: 01a17321-2895-71ed-b498-9b2d68c13219
title: Claude Code cut by offline Agent SDK fork on the execution target — whole and to-turn
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a172f2-8290-7163-b4cf-1a445497752f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17321-2895-71ed-b498-9b2711b4f93a
  - kind: waits-on
    to: 01a17321-2895-71ed-b498-9b29748d138f
  - kind: waits-on
    to: 01a17321-2895-71ed-b498-9b2cefc51f58
---
`tagma harness-run claude-code` gains a cut form: `forkSession(X, {dir, upToMessageId})`, then a `claude --resume Y` launch. The new root's rows are derived from the Y chain in turn order.
