---
id: 01a185b3-6333-7b32-af8b-ed6fd1f270e4
title: A parent hears of its child's unclaimed filed work once per version of that work, not at every rest
ord: 4
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1645e-fc13-7257-a214-aa58e97547b6
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/collaboration/heldTasks.ts
---
The handover line ("stopped working and held …") is an act of one run and is keyed by it. The line naming open work the child filed and nobody took restates a standing fact at every rest, so its key is the sorted set of `name@changedAt` of those tasks: the delivery's idempotent id drops an unchanged set however often the child rests, while a task reopened or edited since, or a new one, makes a new line. Keying by names alone would swallow a task reopened after the parent was told; keying by run repeats the same line after every turn.