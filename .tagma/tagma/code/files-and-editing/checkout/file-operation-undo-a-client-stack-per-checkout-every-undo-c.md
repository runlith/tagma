---
id: 01a118dc-2aaa-7304-950e-40cefb33f467
title: "File-operation undo: a client stack per checkout, every undo checked by the server"
ord: 14
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/files/FileOps.svelte.ts
---
Undo for file operations lives in the client, one stack per checkout, and every undo is an ordinary server operation with its own check.

- A stack step is an `undo`/`redo` pair: creation is undone by moving to trash (redone by `restore_entries` of the same trash bin), a move or rename by the reverse `move_entries`, deletion by `restore_entries` on the trash operation id (redone by a new `trash_entries`, the id changes).
- The server remembers nothing about the chain: a `target-exists` refusal (the target is taken) or `source-moved` (the trash was already collected) is shown to the operator, and the step leaves the stack — otherwise it would block the way to earlier ones.
- Trash keeps an operation for a week and within a free-space share, so undoing a deletion left for a long time can be refused; the "Deleted · Undo" toast lives 8 s, and Cmd+Z in the tree lives until the stack is pushed out (50 steps).
- Open tabs follow the operation: a move carries tabs and documents, including ones nested in a directory; deletion marks tabs "deleted", and restore clears the mark.
