---
id: 01a1124a-1ccd-753c-b235-e971522a8b65
title: "The producer mints the activity id, and the parent is chosen at open: explicit, current, or the named run's root"
ord: 19
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/activity/src/cause.ts
  - kind: file
    ref: packages/activity/src/store/writer.ts
  - kind: symbol
    ref: packages/activity/src/Activity.ts
    symbol: activity
---
The producer mints the activity id at open — uuidv7 from the Effect clock — not the store, so a child opened in the same millisecond already knows its parent's id, and the record does not wait for the database. Within one millisecond the random tail sets the order, not the opening sequence: a reader that cares about order sorts by `opened_at`, not by id.

The parent is chosen once at open: an explicit `parent`, else the fiber's current activity (`CurrentActivity`), else `outside` — a "run X" target. The writer resolves a `{run}` target to that run's root with one query per batch: the run's activity whose parent belongs to another run or is absent. So work outside the run's fiber — settlement, report, a title over the captured turn — lands under the run it belongs to without carrying its id. A warm title, recap, and an external turn's auto-title explicitly name the source run in `parent`: even a call from the current tool does not change which conversation they describe. A manual title generation's actor and trigger come from invocation, while automatic generation names its hook or schedule and its source input or deadline.

A row opened under `{run}` remembers that run in `parent_run` and never itself becomes its root. In the batch the writer writes it ahead of the other rows, and sets the parent after the root search. Otherwise its child from the same batch would look like the run's root, because its parent is not yet recorded, and two rows would become each other's parents. If there is no root yet, it is written parentless, and the break counts as a `loss` row with cause `unattached`; without this the very first such row would become the root, and all the run's following notes would land on it.

A note with no current activity is written to the run's root only if `outside` is named; else the note is not written. A note whose `outside` names a different run than the fiber-inherited activity goes to the named run: a forked fiber outlives its activity, and the inherited frame must not intercept others' facts. A note to a rootless run is lost and counts as `unattached`.

A row's project is its thread's home, which the writer finds itself: by it `read_thread` gathers the project's threads. A threadless row carries the producer-named project (`project`) — so a threadless call's defect names the call's project. Thread, run, project, and actor inherit from the current activity unless named; the root's actor and trigger come from `ActivityCause` when the producer did not set them. A server operation sets the operator, thread, or session and `{kind: operation, refs: [id]}`. An explicit `trigger: null` disables the ambient cause: a run with an empty inbox does not pass the operation that caused it off as delivered input. Without a cause the actor is the server with a kind name.

So an HTTP request's outcome is attributed to its own request: every `model-call` is a separate activity with its own notes, and the second step request's answer cannot land on the first.
