---
id: 01a1649b-1cb6-7d40-88fc-c37c893f7234
title: Thread lines — lines to the parent and subscriptions — go in one delivery with an idempotent id and retraction of the group's unread line
ord: 9
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a15987-1bac-7bff-889d-f8fe1f559854
  - kind: relates
    to: 01a16449-f3a3-7a52-9c4a-904fe82af907
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/store/subscriptions.ts
  - kind: file
    ref: apps/tagma/server/src/threads/subscriptions/delivery.ts
  - kind: file
    ref: apps/tagma/server/src/threads/subscriptions/recipient.ts
---
Lines to a parent about children and thread-subscription lines are one delivery (`threads/subscriptions/delivery.ts`): a signal into the recipient's inbox with id `<type>:<thread the line is about>:<key>`, where the key is the event kind, the recipient, and the event identity (run, question `eventId`, commit, task-end id). Text is not in the id: renaming a thread or changing `wakes` does not turn the same event into a new one. A line with an already-standing id is not sent and retracts nothing, so an obligation retry, a restart, and a repeated "Attention" at start yield no second line and remove no newer one. Delivery to one recipient runs in a queue: retracting an unread line and sending a new one never interleave with another line to the same recipient.

A line's text passes the same projection as a long tool answer (`HarnessToolOutputs`, the recipient's output store): a line larger than the output envelope arrives as its start plus the full text's address for `read_tool_output`. Lines have no truncation of their own, so `rested` (except a run that answered its subscriber with a report) and `addresses-human` carry the run's whole last answer, and merging unread lines leaves the thread with one line holding the last answer.

An unread line about a thread is retracted by the next line about the same thread, but only within its own group, named by the sender (`replaces`). Only a still-queued line is retracted. A line with no wake stands there for a working recipient until its next step, if the run makes it one (on ACP — together with the words the agent is steered for), otherwise — until the next run, as for an idler (the core's `wait` mode, [[fa4f58b1]]), so even a sleeping one holds one line with the last state. Thread state — subscription lines and `ran`, `compacted`, `cooled` to the parent — is one group: a parent that is also subscribed to the child sees one line with the last state. A model change is a separate group: a run's end does not retract an unread selection change. The `deleted` line about a child (id `child-agent-update:<child>:deleted:<recipient>`) retracts that recipient's unread state and model lines about it, and once it stands no later line about that thread is sent to that recipient: a run the deletion stopped settles after it, and its `ran` would otherwise reach a parent already told the child is gone.

Only `rested`, `failed`, `stalled`, `awaiting`, `addresses-human` wake an idle subscriber, and only those the subscription kept in `wakes`; other lines and all lines to a parent wait for its next run. A `rested` of a run the operator's word opened never wakes: the line waits marked `forOperator`. When that run took the subscriber's task and answered it with a report — final or fallback under that run's id — its `rested` neither wakes nor carries the run's last words: the subscriber already received the answer as a report, and the run's last words by the answer law only repeat it. The "report — run" link reads by the task delivered to that run, not by arrival time: an older run's report and service reports (words unread, task recalled) do not mute that `rested`.

A subscription lives in `thread_subscription` and ends on its own: deleting a thread drops it via foreign key, archiving — in the same record that sets the archive (`list/store.ts`), for subscriber and target alike. Restoring from archive does not bring a subscription back.
