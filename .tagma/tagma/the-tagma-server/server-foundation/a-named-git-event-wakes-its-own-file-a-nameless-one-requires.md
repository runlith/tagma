---
id: 01a13226-8e28-74be-83db-f9a420a0ae1e
title: A named git event wakes its own file; a nameless one requires rescanning
ord: 10
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1321c-2265-787f-bcd0-daa6156f2211
sources:
  - kind: symbol
    ref: apps/tagma/server/src/platform/watch/tree.ts
    symbol: watchTree
---
A linked worktree's shared git directory belongs to several checkouts: another file's rename in it never means a config or ignore move. Named events address by file, and a name loss keeps the full rescan. HEAD and the index watch through parent directories, so an atomic file swap never leaves the watcher on an old inode; loose and packed refs belong to the shared directory. A git operation's start and end give a separate `operation` movement, even when HEAD and index are already unchanged: otherwise a snapshot read between a merge commit's publication and `merge --quit` would keep an open merge. Named `.lock` files in refs never wake a read: Git forbids that suffix in any ref-path component, so a lock file's appearance and removal never mean a reference move; an unknown event keeps the rescan.
