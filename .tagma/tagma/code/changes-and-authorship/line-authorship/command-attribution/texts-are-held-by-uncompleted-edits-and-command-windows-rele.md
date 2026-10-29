---
id: 01a1125b-d486-70e8-8045-281ec851d6c3
title: Texts are held by uncompleted edits and command windows; releasing a reference starts digest collection
ord: 1
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a111ab-9639-7730-81d5-59311ee0244c
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/record/collection.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/stamping.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/texts.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/versions.ts
---
Texts in `workspace_change_content` serve uncompleted edits and observed command bases. The base is stored independently of authorship: after an external or overlap edit, a command must tell already-standing bytes from its own. Identical texts share one digest, and `command_content` references hold them until each window decides. The hunk in `workspace_change_text` belongs to the record line; its state transition changes metadata separately from the overflow payload. A turn rollback needs only the line counts of a committed line for `read_rewind` (`committed[].counts`), and only the id of a withdrawn one; to recognize its return, the witness separately stores each line's span and digest before and after, without texts, until the next commit touching the path, and the seen-pass removes it on rebase. A text lives while at least one standing line (`writing` or `held`) or one command-window reference names it in `before_hash` or `after_hash`; a hunk lives until the line commits or withdraws, or while an earlier standing line on the same path stands: the path folding replays it as its hunk ([[4267fd67]]).

**Release rides the same write unit as the transition.** `stampCarried` (landing and discharge alike) and `withdrawVanished` put the departed lines' digests on the `workspace_change_released` queue. The collector wakes on `HeldFeed`:
- `collectReleased` deletes a text only when, in its own write unit, no standing line or command-window reference names it. The text and the reference holding it are written in one unit. Window close puts its digests on the same queue, drops the references, and starts collection; a live reference of another window or line keeps the text.
- `retireTexts` walks the durable `workspace_change_retired_text` queue: a transition to committed/withdrawn and a payload insert of an already completed line put it there via SQL triggers of the same unit, when no standing line stands earlier on the path; a line transition also queues the following completed lines of the path that nobody else holds. A full pass sweeps completed lines with payload that nobody holds into the queue. The queue is a work index, the state is in metadata. The collector counts committed added/removed in a worker, rechecks completion in a write unit, records counts, and deletes the payload; the FK cascades the queue off. Before collection `read_rewind` counts on the hunk, after on counts; with no hunk — on `lines`.

**The full pass** runs at startup and once a day (`scheduleSweeps`). It does the same and also `sweepVersions`: it reclaims versions that never passed through a transition — from lines deleted by cascade with a project or migration, and from intents dropped at startup. Per-transition cost grows with what was released, not with the whole store; partial held-line indexes on `before_hash` and `after_hash` and the index of lines awaiting hunk removal keep the checks cheap.

**A unit is bounded by text bytes**, not line count: SQLite reads every freed overflow page to walk the chain, and the writer stays busy proportionally to pages.

**The file never shrinks.** Freed pages go to the freelist and are reused by later records. Collection never calls `incremental_vacuum`: moving pages off the file tail costs more than the returned space.

**Limit.** Text already lost before the base was observed is not restored automatically. Unreadable, binary, and oversize files stay at digest level; available dirty text is held before a command launches, even when no record line held it before.
