---
id: 01a14b6d-b26d-7ba4-b425-902fd358b5c8
title: Operator notes reach the model after each of their messages — in all threads, in a project's threads, or in one thread
ord: 30
---
The operator says once what to remind agents about, and a short text reaches the model right after each of their messages — in all of their threads, in a project's threads, or in one thread.

**How.** The `read_operator_notes`, `write_operator_note` (add or replace a note in a scope with `text`; without `text` — delete the definition there), and `switch_operator_notes` (enable, disable, or drop the switch of one note or all, `*`) operations. An agent writes and switches them only on the operator's word; "add to my messages …" with no named scope is `user`, "remove" is a switch, "forget" is deletion.

**Behaviour.** Scope: `user` (all of the operator's threads), `project`, `thread`; built-in product notes below them. The same nearer id replaces the farther text. Whether a note is on is decided by switches from the nearer scope outward: its own switch, otherwise `*`; none — on. Each answer is the set that now stands for the thread, with the size it adds to each message.

**Limits and refusals.** A built-in note cannot be deleted (`note-builtin`); long text — `note-too-long`; the enabled set over the shared character budget — `notes-over-budget` with the size.

Code: apps/tagma/server/src/threads/contract/wire/operations/notes.ts#NOTE_OPERATIONS, apps/tagma/server/src/threads/contract/wire/notes.ts, apps/tagma/server/src/threads/operations/notes.ts
