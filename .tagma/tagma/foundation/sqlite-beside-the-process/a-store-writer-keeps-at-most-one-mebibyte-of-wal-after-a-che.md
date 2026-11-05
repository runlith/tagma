---
id: 01a1a918-8134-7924-938e-6b1bb13f33fa
title: A store writer keeps at most one mebibyte of WAL after a checkpointed restart; without the limit the file never gives a burst back
ord: 25
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/sqlite-process/src/host.ts
---
Writers run with `wal_autocheckpoint` off and their checkpoints run in a separate process, so nothing on the write path ever shrinks the WAL file: SQLite reuses it from the start after a full checkpoint and keeps the high-water mark on disk. One burst therefore holds its space for the life of the file — a single retired-generation reclaim left the execution host an 8.8 GB WAL on a volume already below its reserve.

`journal_size_limit` on the writer connection makes the first commit after a WAL restart truncate the file back to the limit. The limit only bounds what stays on disk between bursts, never how far a burst may grow: a checkpoint pass follows every write, so an ordinary cycle needs kilobytes, and a store keeps at most one mebibyte of WAL however many stores a machine holds.
