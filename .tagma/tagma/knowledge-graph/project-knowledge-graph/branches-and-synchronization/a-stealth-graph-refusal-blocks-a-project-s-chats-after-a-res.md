---
id: 01a11bda-6e56-76cb-82bd-833db5d3d0b3
title: A stealth-graph refusal blocks a project's chats after a restart
ord: 18
tags: ["reflection"]
fields:
  {
    "actual": "The UI showed no agents and opened no chat. Two refusals: graph-unmerged in a feature branch and graph-pool — the release was already held by another graph worktree, which the code-worktree list was missing.",
    "command": "Open <project>/chat/01a11b16-b1ef-7c94-92ba-f6f334cc5541?branch=<feature> after a server reload.",
    "expected": "The thread list, history, and message sending stay available independently of a graph Git conflict; a graph refusal applies to graph calls."
  }
---
Filed from project `runlith`.
