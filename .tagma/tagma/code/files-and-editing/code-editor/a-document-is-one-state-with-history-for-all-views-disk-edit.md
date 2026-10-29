---
id: 01a1182b-2b38-7387-9ebd-30d8f194b886
title: A document is one state with history for all views; disk edits map through the uncommitted from base
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/code-editor/src/document.ts
---
Undo history and text live in the document's single `EditorState`; each `EditorView` is a mirror the document creates itself (`mount`) and broadcasts every transaction into. A view created past `mount` is invisible to the document: its edits reach neither history nor `pending()`.

**Why.** In CodeMirror, history is a state field. Per-view history would give two diverging undos for one file (tab and thread stage), and Cmd+Z in one would undo what the other never saw. So Cmd+Z and Cmd+Shift+Z are intercepted at `Prec.high` and run against the shared state when the commanding view is not read-only; a view edit is replayed in the shared state with the same `userEvent`, `time` and `addToHistory`, so undo grouping matches the usual.

**Base and the uncommitted.** The document holds `base` (the disk text with its digest) and `local` — the `ChangeSet` from base to the buffer. Hence:
- A dirty buffer accepts another's edit only through `rebase`: `applyRemote` on a dirty buffer rebases, otherwise overlapping edits would merge through OT and typed text would be lost. An accepted edit maps through `local` and applies outside history (#rule de193c54).
- A conflict is the overlap of their edited lines with ours **in base coordinates**; a line starting exactly at the right edge of our edit is not ours. Two insertions at one point conflict: their order is ambiguous. The answer names ranges in buffer coordinates, where they are drawn.
- `pending()` takes `local` and remembers the snapshot by the returned object's identity; `settled(pending, digest)` moves base to the written text and keeps in `local` only what was typed after the snapshot. If base moved in between (a disk edit arrived), `settled` answers `false`: the write landed over another's text, and the caller waits for a document frame instead of replacing base.
- `keepMine` ("Keep mine") takes the disk as base without touching the buffer; `discard` ("Take from disk") is a single undoable transaction.
