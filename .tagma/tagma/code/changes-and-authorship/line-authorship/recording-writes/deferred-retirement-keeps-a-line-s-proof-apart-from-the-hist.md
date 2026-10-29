---
id: 01a128db-a0e3-7a50-a251-67b4521afa22
title: Deferred retirement keeps a line's proof apart from the history cursor
ord: 3
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a128cd-b4f9-7050-8e98-3dd52b7c48a9
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/record/outcomes.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/retire/driver.ts
---
Deferred retirement keeps a line's proof apart from the history cursor.

An open command window defers a line's durable exit, because the command may still recreate the file. A partial landing of a record never completes it: while another splice of that record still stands in a fresh judge of the working tree, the record stays held. The carrying commit and the overwritten witness persist with the line's digest in the same unit that advances seen; later passes apply that proof without replaying the handled history. A digest shift or lost commit reachability drops the proof, and a new commit on the path drops the former witness. The `commits` and `turns` reads use one snapshot of a line's known outcome: a pending committed proof counts as a landing only on a matching digest and proven reachability from the read HEAD, without waiting for the durable exit. Proof arrival notifies open subscriptions regardless of the durable stamp. An unreadable checkout stays a `stale` side with a reason and never hides the rest; a history without such a side answers with an explicit refusal when the outcome cannot be checked. A late clean after a handled HEAD shift can complete without another shift; a line with its own unchanged head is kept for recovery through stash.

Everything standing on its path is kept too, including lines recorded before the shift: a late line is judged by the fold from the before of the first remaining line, and without the early ones their text would enter that base as an observation. Then returning the file to that version — a `stash pop` or the session's own `write` — would hand the early lines to nobody, and landing would demand `whole`. When the path still equals HEAD at the next HEAD shift, all its lines leave together as `reverted`.
