---
id: 01a151fa-e22a-7b84-aa60-aa746229df6b
title: A terminal flow knows its model and reasoning from birth, and the list row shows them
ord: 23
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fb-6ae2-72a7-8565-b02edaf63602",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/birth/seat.ts
---
The moss-deer row shows "Claude Code" with no model or reasoning: in the core row the provider is `claude-code` while model and reasoning are empty, although Claude Code itself runs on Opus 5.5 xhigh. The model choice is a fact of the core row at every flow, and the adapter receives it at launch; for a terminal flow it now arrives only from hook events (`modelOf`), and without events there is none.

Do: terminal-flow birth writes the model choice — provider, model, reasoning the CLI starts with — and hook observation refines it. When the CLI runs on its own default unknown to Tagma, the row says so directly instead of staying silent. The list row shows model and reasoning the same as native.

Outcome (`b22e8598ce`): harness-flow birth on any transport writes the choice the CLI launches with: the named model, otherwise the operator default if it is on that CLI's provider, otherwise the catalog default for that provider. The same order already took the cross-transport carry. Launch passes the choice to the CLI (`--model … --effort …`). A row with no Tagma choice and no CLI report (an adopted CLI) says "CLI default". The already-standing moss-deer was born without a choice and stays that way.

Proof: a terminal Claude Code birth test — the list row and `read_thread` answer model and reasoning before the first hook event.
