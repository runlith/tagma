---
id: 01a16358-c1a8-7ae4-8574-3cd9de373e6a
title: "A worktree is answered by its repository's engine: a worktree snapshot is a layer of its differences from the base, and its questions go to the base snapshot until its own warms"
ord: 7
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/navigation-ts/src/engine/workspace.ts
---
A worktree is answered by its repository's engine: a worktree snapshot is a layer of its differences from the base, and until its own snapshot warms its questions go to the base snapshot.

TypeScript 7 shares parsed files only inside one process and only under one file name: the same file in another worktree is another path and a second parse ([[33a13e53]]), and an engine per folder cost about 4.5 GiB on runlith. So one repository gets one engine process, and a worktree in it is a `fileSystem` layer over the base snapshot: its differences land by base path, and unchanged files, programs without differences, and their checkers stay shared. Root paths match between base and worktree; only absolute paths leading into the worktree itself need translation — layer links to its `node_modules`.

Differences count from the base disk, not from its snapshot, so a file the base already changed but its snapshot has not accepted still lands in the layer explicitly. When the base accepts an edit, every worktree with its own snapshot gets the same paths as pins with its content: otherwise a file the worktree never changed would quietly become the base's new content as soon as its program rebuilds.

A worktree's own snapshot derives from the base snapshot and replaces the serving one only after warming by repeating that worktree's questions. Until then, and while engine memory admits no further checker set, worktree questions go to the base snapshot, with `changed` holding its differences and files the base changed but its snapshot has not accepted: verdicts hold everywhere except those files, which the kit returns as "changed after snapshot" — as right after its own edit. After the base HEAD shift such worktrees wait for the engine to count its changed paths: otherwise the old base snapshot would confirm places in files that already match the new base at the worktree. One worktree warms at a time, and only while engine memory with room for its growth and one repeat warm-up after an edit stays under 90% of the ceiling: at the memory edge edit absorption stretched from 14 to 40 s, and first answers to 9 s.

A worktree with no differences is answered by the base snapshot with no layer, and its own snapshot, whose differences vanished, is released. On its dependency change and its rescan its own snapshot rederives from the base: programs matching the base again become shared, and there is no other way to remove a link from the layer. When the base drops file caches or accepts its rescan, the worktree's own snapshot is released, and until a new warm-up its questions go to the base snapshot again ([[61d1db53]]). A worktree HEAD shift puts into the layer only paths whose difference from the base changed ([[6324930f]]).
