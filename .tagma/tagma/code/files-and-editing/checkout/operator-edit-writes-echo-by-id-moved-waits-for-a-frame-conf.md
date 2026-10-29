---
id: 01a118dc-2a9f-7f34-9f6c-d75307efec0d
title: "Operator edit writes: echo by id, moved waits for a frame, conflict accumulates the disk, unwritten survives the tab"
ord: 13
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/files/Documents.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/files/OpenedDocument.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/files/Writes.svelte.ts
---
Operator writes go through the document's `Writes` (`OpenedDocument.writes`), and the document's feed frames are parsed by `OpenedDocument` itself; the invariant between them holds the order: only disk frames and `settled` touch the buffer, while a write only sends a `pending()` snapshot.

- **Your own write is recognized by id.** The client invents a `write`; the server returns it in a `change` frame. An echo (a `change` or `whole` frame with the id of a running write, and a `whole` with the same text when a file is created) calls `settled(snapshot, digest)` and nothing else: the buffer is untouched. The `ok` answer does the same when the echo did not arrive first; which of the two came second does not matter, because a frame whose digest already equals base is ignored.
- **`moved` is not a refusal.** The disk moved ahead: the write changes nothing, `Writes` waits for a frame with the new digest, and once the base has moved it writes again (after three instant consecutive retries — only on a frame). Without a frame for 3 s the document resubscribes and receives a `whole` that releases the wait even when the digest is unchanged; a `whole` over an existing buffer turns into base-diff edits computed by the worker (`Differ`, exact, no ceiling; the answer arrives when ready, frames behind it queue, and an answer after a subscription or base change is dropped by generation), so it too goes through `rebase` instead of replacing the buffer.
- **A conflict stops writes and accumulates the disk.** While it stands the buffer is untouched, and disk frames accumulate into the `disk` text (feeding "Compare", "Keep mine" — `keepMine` with base = disk digest — and "Take from disk" — `discard` + `applyRemote`). Disk accumulates by frames and reads lazily (`DiskText`), so the frame stream costs by edit count, not file size. A separate holder reader of that same document's checkout (`HoldingsReading`) reads holders for the banner and holds it only while the conflict stands. An edit that returns the buffer to base lifts the conflict on its own.
- **A file deleted on disk does not resurrect without a new edit.** A `gone` frame on an open document only sets the "deleted" mark (one per registry; tree deletion sets the same one) and clears the timer; a write creates the file (`base: null`, whole text) only after the operator typed something after that or pressed Cmd+S. Autosave and focus loss never resurrect edits typed before the deletion.
- **`binary`, `tooLarge`, and `unreadable` frames never wipe a dirty buffer.** Buffer and undo stay; the write is refused with a reason; a clean buffer leaves as before.
- **The autosave mode decides what writes on its own; Cmd+S always writes.** `Writes.on(trigger)` matches the trigger (`focus`, `window`, `hide`, `command`) against `editor.autoSave`; the `afterDelay` delay is taken on every edit, and a mode switch applies to an already dirty buffer at once. Edits typed during a write go with the next cycle: it is queued after `running` clears.
- **Unwritten content outlives tabs and context.** The `Documents` registry lives in the app tier and is keyed by `(project, root, path)`: switching project or branch closes views but not the document while it is `unsettled` (dirty buffer, running write, refusal, conflict). Closing a tab finishes writing it; on `off` it asks "Save / Don't save / Cancel", on refusal — "Not saved". A close that did not wait out the write within 8 s asks the same.
- **Hot exit.** A dirty buffer lies in `Drafts` (text and the disk digest it started from) after a typing pause and immediately when the window hides; the shared limit is 1,000,000 characters, and whatever does not fit is protected only by `beforeunload`. A new document reads the draft on its first `whole`: digest matched — the buffer stays dirty, otherwise it is a conflict with the disk as base. The draft leaves once the buffer is clean.
- **An out-of-window write request carries `keepalive` only when it fits.** The one limit is on `Door` (60,000 UTF-8 bytes): both the write on window hide and the shared `pagehide`; whatever does not fit goes as an ordinary request and is protected by the draft or the close warning.
- **A link between frame and unanswered write.** A write with no answer for 20 s is a "did not answer" refusal; the ids of such writes are remembered, so a late frame with their id counts as an echo, not someone else's edit.
- **Before deletion and move, buffers are finished** (`Documents.settle`) and their autosave is muted for the operation: otherwise rollback would read a stale disk and a write would recreate the deleted file.
