---
id: 01a1645e-fc13-7257-a214-aa58e97547b6
title: One owner in `threads/events` derives thread events, and each recipient subscribes to the run end separately, under its own name
ord: 8
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a16449-f3a3-7a52-9c4a-904fe82af907
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/events/happened.ts
  - kind: file
    ref: apps/tagma/server/src/threads/events/modelChanges.ts
  - kind: file
    ref: apps/tagma/server/src/threads/events/standing.ts
---
The owner in `threads/events` knows two things about a thread. What stands at the thread now (`standingOf`): a question waiting for the operator, an unseen fall, a finished root no longer owed the end of its own background command or call (`owes`, from `OwnWork`) — with an `eventId`. A question with an approver agent does not stand; "Attention", the pulse, and the `awaiting` event read this output, push reads the "Attention" rows, and none of them checks the approver itself. The same conditions in SQL (`standingDriven`, the "Attention" candidate select by index) stand beside `standingOf`: two forms of one output, and they change together. The SQL form is a superset: it reads only write paths declared in `store/fields.ts`, and `approver` is not among them because the journal-form step changes it, so only `standingOf` decides the approver condition. What happened to the thread (`ThreadEvent`) comes from four sources:
- a notification-obligation run end: `ended`, and for the thread's last turn also `failed`, `stopped` (operator stop), `rested`, and `addresses-human`;
- a standing change: a question waiting for the operator produces `awaiting` once per `eventId` — the owner watches "Attention" rather than re-deriving the question;
- live-feed thread status: a thread in flight moving to `stalled` (the same measure as the thread row) produces `stalled` for the thread itself and each of its ancestors;
- a cache-cooling timer (`cooled`) and facts from outside producers through `told`.

Whether the operator opened the turn is derived once by the owner (`events/opener.ts`): a turn into which the reader's delivered words went, or a turn with no delivered inbox opened by a user message in the journal. `ended` carries it as a read the recipient makes only when it needs the fact: ends do not read it for apps, and for rows to the parent only for the turn being reported. `rested` carries the ready value, and the subscription reads it. The operator's turn is his own conversation: `addresses-human` is never asked for it, and `rested` reaches the subscriber as a quiet row with a mark.

`rested` means the turn has ended and the thread will not wake by itself: no thread of its subtree is owed the ending of its own background call or command (`OwnWork`, asked for the subtree's threads only), and then no thread of the subtree has a waking inbox entry queued or a run in flight. `OwnWork` is read first because a debt only moves forward — call, then command delivery, then an inbox signal, then a run — so a debt moving between the two reads is caught by the second. A lead whose turn ended with running children, or with a child waiting on its own command, has not stood; it stands on the turn after the last report. Task-holder standing (`holders`) reads the same fact, so a holder waiting on its own command stays `working` and its tasks are not offered to another session. `addresses-human` is asked only of a root that has not stood, and only while someone watches it: the decision (`ThreadDecisions`) reads the turn's last words. A decision refusal produces no event — its record stays in the decision's own activity. Decisions live one layer above the engine and reach the owner through `serveDecisions`; an end arriving ahead of them refuses and is retried by the obligation.

The owner subscribes each recipient to the run-end obligation separately, under the recipient's name. The name is the obligation cursor: each recipient has its own claim and retry, and a fallen recipient does not repeat delivery to those who already received it. Renaming a recipient means losing the cursor: unfinished obligations under the old name would be delivered to it again.

The recipient's `follows` decides whether it needs the thread before the owner derives anything expensive: costly derivations (`rested`, the `addresses-human` decision, the cooling timer) run only for threads someone watches. The recipient itself checks addressee liveness on delivery (whether a parent exists, whether the app works, whether the subscriber is archived).

An outside producer reports a fact through the shared `told(threadId, fact)`: the owner reads the thread row and hands the event to recipients with `takes` and `follows`. `committed` and `task-closed` arrive from lower-module ports (`CommitLandings`, `WorkEnds`) subscribed by the threads layer. `ModelChanges` records the old and new choice in the same write transaction, so the event does not depend on the switching door; a rollback and a write of the same provider/model/reasoning triple produce no event.
