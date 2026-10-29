---
id: 01a118ce-1d2c-7375-bad6-a0c940a4116c
title: Tagma's trash lives in the checkout's git directory, keeps a week and a tenth of free space, and is collected at startup and daily
ord: 5
tags: ["explanation"]
sources:
  - kind: dir
    ref: apps/tagma/server/src/checkout-files/trash
---
Tagma's trash bin lives in the checkout's git directory, keeps a week and a tenth of free space, and is collected at startup and once a day.

Operator deletion is a rename into `<git-dir>/tagma/trash/<act>/entries/…` next to a `manifest.json` (time, the act's roots, committable files with digests); restore is a rename back plus creation facts from the manifest. The git directory, not the OS trash: the same volume, so delete and undo are one rename with no copy, no per-OS adapter, and the trash leaves with the worktree. On another volume — a copy to a temporary name next to the target, a rename into place, then the source removed. A copy failure leaves nothing partial in the target; a removal failure after a full copy counts as a completed move, the leftover named in the log and span.

- Invariant: the single copy is never deleted. If undoing a delete did not bring something back to the checkout, the act stays in the trash, and the refusal names what remains.
- The manifest writes before the move: restore and the collector read the act without walking the tree. The act's home after restore is removed after `land`, as able: a cleanup failure never revokes restored files' facts.
- An act filling a delete or read by restore holds `TrashActs`; the collector skips it. A file that vanished concurrently counts as zero when sizing.
- A mid-process fall does not roll back, but each root is one rename, and `settleIntents` reconciles facts with disk.
- The term is a week: the undo stack lives with the client in the session, and a week covers a reopened window. The space budget derives from the machine: a tenth of the trash volume's free space at collection time (fe83acfa); the oldest acts go past it.
- The `trashSweep` collector plugs into the module layer through `scheduleSweeps` (after Maintenance opens, then daily); it takes roots from `FileRoots.active`, the git directory from the root's git facet, and `rev-parse --absolute-git-dir` (cached per root in `GitDirs`) only for a root without a facet: otherwise a start with N worktrees would cost N git processes. Each root sweeps under a `background`-class ticket of the shared `heavy` pool `Capacity`: when the pool is busy, call tickets (`call`) go first. A non-repository root is quietly skipped. Only acts that may still remain are sized. Each pass is one `CheckoutTrash.sweep` span.
