---
id: 01a117dd-98e5-7df2-86cb-e3fa588b85a5
title: "Operator edits and file operations: autosave, rebase of others' edits, conflict only on crossing, move and delete to the Tagma trash with undo"
ord: 8
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
The operator edits files with autosave, creates, renames, moves, and deletes them as in VS Code or Orca, while agents write into the same checkout: their edits merge into the buffer, and only an edit of the same rows asks a question.

## Autosave

- **Autosave is configured as in VS Code**, and is not the only mode. The `checkout-files` module declares the keys in the manifest (`settings`, "Editor" section):
  - `editor.autoSave` — `off` | `afterDelay` | `onFocusChange` | `onWindowChange`; default `off`, as VS Code on desktop: defaults match VS Code everywhere the operator did not say otherwise;
  - `editor.autoSaveDelay` — the `afterDelay` delay in milliseconds, default 1000.
- Modes: `afterDelay` — write after a delay since the last edit, plus at once on editor blur, tab switch and close, window hide (`visibilitychange` → request with `keepalive`); `onFocusChange` — only on editor blur, tab switch and close; `onWindowChange` — only on window blur; `off` — only by command. Cmd+S writes at once in any mode.
- A mode switch applies to open buffers at once, without reload: an already dirty buffer is written under the new mode rules.
- While autosave is off, agent edits in the same file hit a conflict more often — the dirty buffer lives longer; "Compare" / "Keep mine" / "Take the disk" stay the only way to reconcile.
- With `off`, closing a dirty tab asks "Save / Don't save / Cancel", and closing a window with unsaved state asks `beforeunload`; this is not a permission request but protection against losing what was typed (0f144655). In other modes the question appears only when the write failed.
- The tab dot is "unwritten or writing", the red mark is "write failed".
- A refusal leaves the buffer dirty and is visible in the banner with the reason; a failure never becomes "saved" (ea465bed). A `moved` refusal (the disk moved) is not an error: the buffer waits for the document frame and rebases. A storage refusal is retried by the next edit or a button.
- Closing a dirty tab first writes it; when the write failed the question is "Not saved: {reason}. Close without saving?". Closing a window with an unwritable buffer warns with `beforeunload`.
- **Hot exit, as in VS Code**, always, without a setting: unsaved state never vanishes on window close and reopen. There is no switch — a mode where unsaved state is lost on close is not needed (operator decision). For every dirty document the client storage holds a draft — buffer text and the disk digest it started from (draft write is deferred to a typing pause and done at once on window hide). Drafts are bounded by a shared size limit: a document that missed the limit is protected only by the `beforeunload` warning. On tab restore the document is read from disk: digest matches — the buffer becomes the draft and stays dirty; does not match — the same state as a conflict ("Compare" / "Keep mine" / "Take the disk"), because the client has no source text to merge from. The draft is deleted when the write landed or the operator discarded the edit.

## A file changed while open

- **Clean buffer** — the frame delta is applied with the kit's `applyRemote` [[1759d27d]] outside undo: cursor and scroll shift by themselves.
- **Dirty buffer** — `rebase`. No crossing — their edits are brought in, ours remap, autosave keeps writing; the operator watches agent rows appear around the edit. Crossing is a **conflict**: autosave pauses, the buffer is untouched, the banner names the holders from Holdings and offers "Compare" (a "disk ↔ my buffer" diff tab), "Keep mine" (write with base = new disk digest), and "Take the disk" ("Undo" toast for 8 s). Orca blocks autosave on any external edit of a dirty buffer at once, VS Code learns of the conflict only on save; we ask only on crossing.
- **Echo.** A frame caused by our own write carries its id: the buffer only shifts base.
- **File deleted on disk** — the tab stays marked "deleted", autosave does not resurrect it; typing further creates the file exclusively.

## File operations

- New File / New Folder — inline field in the tree (a name with `/` creates intermediate directories), rename by Enter or F2 with extensionless name selection, delete by Cmd+Backspace, move by drag, multiselect for delete and move, Copy Path / Copy Relative Path, Reveal in Finder (desktop), "Find in folder".
- No confirmations (0f144655): an "Undid · Undo" toast and Cmd+Z / Cmd+Shift+Z with tree focus — a per-checkout undo stack on the client. Every undo is a server operation with its own "target did not move" check, a refusal is shown.
- Before delete and move, unwritten buffers of affected paths are written through and their autosave is muted — otherwise undo would read stale disk. Rename and move carry open tabs, including tabs inside a directory; delete marks them "deleted".

## Server (`checkout-files`)

All operations are `callers: 'operator'`, go through `Intake` with the operator holder [[eefb0e60]].

- **`write_document {path, base, edits: LineEdit[] | text}`**: queue `Intake.turn` → read bytes, `base` ≠ digest → `moved {digest}` refusal → `contentOf`, not text → `not-text` → `applyLineEdits` → `changeOf` → `Intake.land` (intention, CAS, confirm or glue) → document cell frame with the write id. `base: null` + `text` is exclusive creation. Refusals: `moved`, `not-text`, `too-large`, `graph-path`, `path-outside-tree`, `record-unread` (file untouched), `file-write-failed`; answer `{digest, kept}`, `unconfirmed` says "file written, row awaits start".
- **`create_entry {path, kind}`**: file is exclusive creation of an empty file, the "no → empty" fact (empty and missing differ in digest and fold, so a new untracked file becomes nobody's); directory is `mkdir`, does not become a fact.
- **`move_entries {pairs}`**: file is a delete+create pair with `movedFrom` in one `land`; directory is one `rename(2)`, facts are pairs per file git can commit (`filesUnder` before the move), without texts ([[eefb0e60]]); queues are taken in path order. Refusals: `target-exists`, source moved.
- **`trash_entries {paths}`**: rename into the trash `<checkout git dir>/tagma/trash/<operation>/…` (copy and delete on another FS), `delete` facts on committable files without texts; answer is the operation id. **`restore_entries {trash}`** is the reverse rename and creation facts; occupied target is a refusal.
- **Trash** is owned by `checkout-files`; lifetime and space budget are derived (fe83acfa); the sweeper starts on boot and once a day and is connected by the same delivery (a00f91b0).
- Agent `delete` and `rename` work only with files; directories are the operator's capability.
- The document cell [[9c88344d]] gets a `moved` frame here (newest path-rename fact at the change record) and a `write` field in `change` — the write id the frame was called by.

## Laws written with the delivery

- #rule on `apps/tagma/server/src/checkout-files`: "Write to a checkout from this module only through Intake, on the operator's behalf" — otherwise the first fast write past it returns nobody's rows, which leave with an agent landing.

## Client (`features/files`)

- `Documents` (app tier): open documents registry by `(rootId, path)`, view refcount, `document.subscribe` feed, kit `TextDocument`, base digest, autosave, write state (`idle | pending | writing | refused {reason} | conflict {ranges, holders}`), rebase.
- `FileOps` (graph tier): file operations and their undo stack.

## Deleted

The open-in-terminal stub, unless [[b51edd1b]] removed it.

## Acceptance

Implementer:
- saving on moved disk is a `moved` refusal, then rebase and write;
- own write echo does not change the buffer;
- moving a 1,000-file directory is one intake operation, `Holding.from` on each, ignored without rows;
- trash sweeper startup call is visible in the span.

Operator on the dev stand (not a completion condition, 8dab19b6): open, edit, close, reopen — changes on disk; an agent edits the open file — rows appear around the cursor; same-row edit is a conflict banner; rename, move, and delete with undo; the Git tab shows "Your changes", and a commit takes them; an agent landing does not drag its rows along.
