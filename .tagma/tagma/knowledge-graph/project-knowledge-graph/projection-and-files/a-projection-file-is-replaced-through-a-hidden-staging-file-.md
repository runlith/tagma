---
id: 01a1512b-666a-7a76-86c2-dfa5f0aad626
title: A projection file is replaced through a hidden staging file next to the target, and the staging path enters the ledger as its own echo
ord: 8
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a15120-d6f7-7dee-8d80-951a0f0e6f1e
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/tree/atomicFile.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/tree/batch.ts
    symbol: captureTree
  - kind: symbol
    ref: apps/tagma/server/src/graph/tree/projection.ts
    symbol: projectDelta
  - kind: symbol
    ref: apps/tagma/server/src/graph/tree/shadow.ts
    symbol: shadowAt
---
A projection never writes a block's text straight into its path: mirror repair would read a file truncated by a crash as truth ([[7f692a1a|two-phase move]] tells what loss that already caused). The text goes into `.<name>.tmp` in the same directory, fsync-flushed, and takes its place by rename — after a crash the path holds the old or the new text whole; directories where renames landed, and parents of directories created for the write, flush once per write batch, not per file. The leading dot hides staging from tree walks and scanners, like the `.moving-` parking; the same directory is needed so rename never crosses a volume.

Staging abandoned by a crash between creation and rename never accumulates and never enters graph history. The name is constant per path, so the next write of the same file overwrites it. A full projection deletes staging found during the walk: it writes the tree alone, so each of them is abandoned. Tree capture for batches (`captureTree`, through which both stealth and team trees publish) skips staging, and `commitAct` and `concludeMerge` exclude it by pathspec. `commitAct` judges whether there is anything to commit by the index, not by `status`, where abandoned staging shows as untracked. In a team checkout's working tree abandoned staging stays an untracked file until overwritten by a write of the same path or deleted by a full projection.

The tree watcher also reports a staging file that is already gone when the event arrives. `projectDelta` passes its path into `touched` as neither staged nor restorable: the ledger remembers its absence, and the event reads as an echo of its own write. Without this every act that wrote a file would wake a tree refresh.

So `projectDelta` writes synchronously: the file write and its `touched` mark are indivisible. An async write would yield the event loop in between: the watcher event would arrive before the mark and wake refresh, and an act interruption would roll the transaction back while an abandoned promise finishes writing a file undo knows nothing about. `projectDelta`'s work is bounded by the act (writeThrough slices it into block batches). The unbounded `restorePaths` walk uses async fs but runs uninterruptible: interruption awaits the restore's end.
