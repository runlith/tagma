---
id: 01a11364-aaf2-7196-81cb-d9da8682e2b1
title: reshape applies the delta of the transformation to working files as a three-way merge, and a nobody's record never goes to a parallel command
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/contract/wire/reshape.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/lives.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/reshape.ts
---
reshape applies the delta of the transformation to working files as a three-way merge, and a nobody's record never goes to a parallel command.

`ChangeRecord.reshape` applies to working files the delta the transformation gave the commit version: `before` and `after` are that version's blobs before and after, and the disk is the "ours" side of the three-way merge. It is needed because the working file holds others' uncommitted lines, and the delta can neither be applied on top nor dropped: overwriting would lose others' lines, and refusing would leave the file in its old form with the session holding lines already in the commit.

**What counts as "before" and "after".** Both blobs are read in the file's working form (`cat-file --filters --path=`, the user's settings), otherwise a CRLF file conflicts whole under `core.autocrlf`. Merging is a `git merge-file` subprocess (`mergeFileAt`), not code on the event loop. The disk is read once; matching `after` means the file is already in form; matching `before` writes `after`; otherwise merge-file.

**Per-path outcomes.** `merged`; `unrecorded` — the record landed but the session's line was never recorded (`revertLines` answers the same); `kept` with a reason: `conflict` (others' lines at the same places, the file stands where a hook created it, edited where a hook deleted it), `moved` (the file vanished or moved between read and write), `unreadable`. A file a hook added (`before` null) is only created onto an empty place, a deleted one (`after` null) only while still equal to `before`; `Reshaped.mode` (100644 or 100755) is only set when the mode changed or the file is born: it applies at creation, at content write, and as chmod on a file whose content already matched (a write that changes no lines never creates a session line). reshape never receives symlinks or gitlinks. Recording runs through the `LineWrites` CAS port, so a shifted file is never touched.

**Who holds what was recorded.** `held` — recorded as the session's line, like a typed-tool edit. `unheld` — nobody's: there is no line, and the record belongs to no session. So a parallel shell command never claims it for itself, the `LineWrites` port registers a nobody's mark (`Lives.unowned`) in the record itself — after the final `before` check, right before publication — and removes it when publication never happens or fails (so a CAS miss never hands the mark to a parallel command that wrote the same bytes). The mark: it matches on the `after` digest and on `moved.at ± WRITE_GAP` or on the command window, and yields an `unclaimed` verdict. It is keyed by the checkout id the reshape root stands in (`CheckoutPaths`), not by thread: a root that is not a project checkout makes `reshape` refuse `root-unproven`. The mark is also a command-journal line (`command_unowned`): a command window decided again after restart sees it the same as before restart.

There is no line in the base at a nobody's record: other sessions' hunks are searched as windows in the text, and the new HEAD and the disk carry the same delta. That is concluded from reading `holdersOf`/`netOf`; the chain of others' lines after such a record is untested.
