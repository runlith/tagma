---
id: 01a14c13-c481-7acc-8aa6-03c3d1f6564f
title: The operator creates, renames, moves, and deletes files in the tree; deletion goes to Tagma's trash and is undone
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03c6a28ec4cb
sources:
  - kind: dir
    ref: apps/tagma/server/src/checkout-files/entries
  - kind: dir
    ref: apps/tagma/server/src/checkout-files/reveal
  - kind: dir
    ref: apps/tagma/server/src/checkout-files/trash
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/files/FileOps.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/files/TreeMenu.svelte
---
**Value.** File operations need no terminal or confirmations and are reversible, while agents in the same checkout see them as the operator's edits, not nobody's.

**How.** Tree menus and keys: New file, New folder, Rename (F2 or Enter), Delete, drag-and-drop, multiselect, Copy path, Copy relative path, Reveal in Finder, Find in folder; the "Deleted · Undo" toast and Cmd+Z / Cmd+Shift+Z in the tree. The `create_entry`, `move_entries`, `trash_entries`, `restore_entries`, `reveal_entry` operations.

**Behaviour.**
- A name with `/` creates intermediate directories. A move checks all pairs before the first step and returns the already moved on a mid-way failure.
- Deletion moves records to the trash inside the checkout's git dir under one id; restore returns them to their former places if free.
- Undo is a per-checkout stack at the client; every undo is an ordinary server operation with its own check, and a refused step is removed from the stack.
- Every file git can commit is recorded in line accounting as the operator's edit; a move as a deletion-creation pair with a source. Open tabs follow the move, deleted ones are marked.
- Before moving and deleting, unsaved buffers of affected paths are written through.

**Limits.** The trash keeps an operation for a limited time and within a share of free space, so a long-ago undo may refuse. Moving a directory to another volume refuses. Only the operator moves and deletes directories: the agent's `delete` and `rename` are per-file. Reveal opens the server machine's file manager.
