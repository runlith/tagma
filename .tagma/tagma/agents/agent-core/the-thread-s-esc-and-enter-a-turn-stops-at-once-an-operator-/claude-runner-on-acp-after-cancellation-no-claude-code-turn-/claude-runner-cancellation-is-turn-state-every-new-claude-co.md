---
id: 01a15f02-9ef7-7e15-9565-8c5fa6e382de
title: "Claude runner: cancellation is turn state, every new Claude Code turn interrupted, an early-word queue"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15f02-5d74-78a2-9337-50d0730ce132",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15eeb-6b48-7ca8-9c93-24d5a5ed6cb2
---
Implement [[a5ed6cb2]] in `runner/claude-code`: cancellation stays as turn state and interrupts every new Claude Code turn on the fact of its start; words without an echo return refusal -32800; awaiting `tools/list` and reopening are interruptible; a word during reopening waits in the runner queue; a failing `interrupt()` closes the query.
