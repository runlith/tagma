---
id: 01a13fb8-c103-71a7-b8d8-6f91afba956c
title: A temporary checkpoint lock is no writer loss
ord: 9
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/sqlite-process/src/channel.ts
  - kind: file
    ref: packages/sqlite-process/src/Checkpoints.ts
---
BUSY and LOCKED of the service WAL probe or a PASSIVE checkpoint leave the writer's already-done work successful: a cursor read not to the end may hold an implicit read transaction with inTransaction=false. Service returns to the same deferred pass that continues the partial PASSIVE checkpoint after the reader frees. SQLite code crosses IPC with no errno loss: IO, a wrong protocol and a lost checkpoint process keep the owners' loss notification, so an arbitrary error never turns into a temporary lock.
