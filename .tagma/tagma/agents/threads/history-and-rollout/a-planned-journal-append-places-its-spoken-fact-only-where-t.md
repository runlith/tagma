---
id: 01a1908c-f375-7841-8b0c-4f8d5bc4f1ea
title: A planned journal append places its spoken fact only where the conversation mark reached its position
ord: 15
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a19024-7ec1-7479-b7dc-1386eb690904
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/journal/conversationIndex.ts
---
A journal append planned into a write program places its spoken fact — a message or a user-message signal — in the conversation index within the same program. Every placement statement carries the condition that `thread_conversation.through` stands at the fact's position once the program's mark statement ran: the interactive path places a fact only when the mark moves onto it, and an index lagging behind its journal is caught up later from the log, in order (`conversationCarried`). Without the condition a planned append would index a message ahead of the facts before it, and catch-up would place it a second time.

The placement's reads — branch layers reading this thread, the message row standing for the entry, the run's quiet mark — come from the reader and are guarded at commit. A thread a branch reads, facts that rewrite the conversation (withdrawal, branch, rewind, restore), a keep-warm signal, and a second placement of one message in one program are not planned; their appends take the interactive unit.
