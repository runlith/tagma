---
id: 01a17c03-4ecb-711b-af40-7dd61d89df23
title: "A dead run root is removed by one sweep: it first takes the root by renaming it to its own name"
ord: 18
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/testbed/src/core/run.ts
    symbol: sweepRuns
---
Fresh runs starting together see the same dead roots. Recursive `rmSync` in Bun on macOS starts with `unlinkat` of the root, gets EPERM for a directory and refines with `lstat`; when another process removed the root between these calls, Bun returns the original EPERM, and `force` does not quench it. From preload this dropped stand preparation whole: files ran with no guards and no guard.

So `sweepRuns` first takes the root by renaming it to its own `<pid>.swept.<uuid>` name and deletes that; whoever loses the rename gets ENOENT and walks on. The new name passes the same entry filter and belongs to a living sweeper, so others never touch it, and a sweeper's root left by dying mid-delete is taken by the next sweep as a plain dead one.
