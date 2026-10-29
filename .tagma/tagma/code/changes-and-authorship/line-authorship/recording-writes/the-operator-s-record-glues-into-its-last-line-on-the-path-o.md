---
id: 01a118ac-f587-7e68-82cb-ab204e239652
title: "The operator's record glues into its last line on the path: one line and one version over the base for a whole autosave run"
ord: 2
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a11808-74cb-7b06-9e37-7332919272b1
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/record/joining.ts
---
The operator's record glues into its last line on the path: one line and one version over the base for a whole autosave run.

The editor autosave writes every second, and each record line holds full before-and-after texts: ten minutes of editing a 60 KB file would yield 100–200 versions before a commit. So the operator's W record glues into its R line, not into a line of its own.

**When it glues.** R is the operator's held (`held`) line on the same place, the latest standing line on the path, `R.after = W.before`, and neither is a delete, a move, or a rollback. Another holder's line after R forbids gluing: otherwise the glued R would rewrite the version the thread edited over, and folding would lose its marks.

A command window on the checkout opened after `R.at` (`Lives.openedSince`, checked both before and inside the unit) also forbids gluing. R keeps its `at`, and the command's `transitionsOf` and the post-restart window decision see lines by `at` inside the window: a glued edit would hide from the window, the command would record its V1→V3 transition instead of V2→V3, and after a restart the path would go `unattributed{restart}`.

**Exiting a line never stamps someone else's version.** The exit decision's driver (`Leaving`) carries the line's `after` the decision was made on, and `RetireStore.leave` applies it only to the line with the same `after`. A glue between the decision and the write leaves R held, and the next pass decides it again.

**"Fact before file" order does not change.** W's intent and CAS write go the usual way. The `R.before → W.after` hunk counts in the walk worker before the confirming unit (large texts never ride the loop). One unit verifies R is still last and `R.after` never shifted; then `R.after = W.after`, the hunk and R's mode are rewritten, W is deleted, the intermediate version handed to collection. Otherwise W confirms on its own. A restart between the file write and the glue decides W at startup like any intent.

**What the judge pays.** A glued R keeps its id, so the path fingerprint includes held lines' `after` digests, and the fold cache is valid only when every folded line's id and `after` digest match. Without this, the path verdict would freeze on the first write.

**The price.** The glue hunk recounts the full `R.before → W.after` pair in the walk worker, and the fold cache on a glued path resets with folding from the start: both O(file) per save. Growth order matches the write itself (CAS writes the whole file). Composing W's hunks over R and rewinding the fold one step are cheaper but not done: they can only be verified by an "equals a full recount" property, and that is a separate job. R's `before` text comes from the small `BaseTexts` cache (8 versions) on `RowIntake`. A glue miss from a busy worker or a read failure shows in the `Intake.join` span (`intake.unjoined`), and a warn logs once per miss run.
