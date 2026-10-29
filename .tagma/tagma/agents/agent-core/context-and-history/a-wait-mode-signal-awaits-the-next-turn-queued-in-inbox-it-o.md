---
id: 01a16562-f526-7bb9-80a2-4ed4fa4f58b1
title: "A wait-mode signal awaits the next turn queued in inbox: it opens no turn, holds no compaction barrier, and does not mark the thread busy"
ord: 11
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a15987-1bac-7bff-889d-f8fe1f559854
  - kind: relates
    to: 01a1649b-1cb6-7d40-88fc-c37c893f7234
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/process.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/prompts.ts
  - kind: file
    ref: apps/tagma/server/src/threads/events/reads.ts
  - kind: file
    ref: packages/agent/src/thread/run/scheduler/inputs.ts
  - kind: file
    ref: packages/agent/src/thread/run/scheduler/queue.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadRunInbox.ts
  - kind: symbol
    ref: packages/agent/src/thread/inboxItems.ts
    symbol: waitsForTurn
---
The mark lies on the entry itself (`body.waits`), because "will this entry open a turn" is decided later and over one inbox: follow-up at the turn end, lifting the admission hold, the end of keep-warm and compaction, server restart. Without the mark, every unread queued signal would open a `history` follow-up turn, and a line without a wake would wake the thread right after keep-warm or compression.

Readers asking "will the thread go on its own" skip it: a follow-up opens only when the queue holds something besides waiting lines (`queue.ts`), the compaction-barrier head passes them by (`compactionHead`), the snapshot's `wordsWait` does not count them, the thread events' `busy` neither (`rested` and the task-holder state, `threads/events/reads.ts`), and an idling ACP process is not held for them. Readers asking "what will the next turn read" take it: a turn opened by operator words, a signal, a task, or a report, and a continuation of an interrupted turn, lay it at their start and write under that turn, not the earlier one. A running native turn reads it on the next step like any signal, but takes no step for it: a turn that finished its answer does not continue on it (`asksStep` in `ThreadRunInbox`), and unread it stays queued until the next turn — otherwise a line arriving while the model writes the final answer would continue the turn with a step of it alone. The ACP driver holds the same rule: mid-turn it hands the agent `_tagma/steer` only together with words demanding a step (`ProtocolPrompts.midTurn`), because the Claude runner does not end the prompt until steer is answered, and would continue the turn for one waiting line. The write resolves the opening race: `wait` in its transaction checks the running turn and, when one already exists, delivers the line to it as running, while every turn opening from rest — by operator words, follow-up, continuation, wake — applies in its transaction the same entry-selection rule it collected them by in advance, and on any divergence, whether an arrived or removed entry, reassembles (`sameCohort`) — otherwise a transport reading words only at turn launch would skip the line for a whole turn, and a removed line would return to the journal. Keep-warm and compaction do not read words and leave it standing. So any signal arriving in such a run is not handed to the transport (`send` in `inputs.ts` hands words only to a run of the `turn` kind) and stands queued until the turn after it. ACP sends keep-warm as an ordinary prompt, and a steer into it would extinguish the signal by reading it in the warmup, where the agent is told only to answer ok and the tools are closed.

The `wake-completed` mode, by which ends of its own commands and background calls arrive, sets the mark not in advance but on the road the admission took. The line goes to a running turn without the mark and asks for a step; a turn that ended without it is followed by a follow-up turn it opens. It wakes an idling thread only when the last run is completed, or it is keep-warm: that goes only after a turn that was not stopped, broken, or cut. Otherwise the line lands with the mark. Had the mark been chosen by the thread snapshot before admission, the choice would race the turn opening: a marked line admitted by an already-running ACP turn would never reach the agent and would open no follow-up.

While the line stands queued, the sender removes it with `retractSignal`: thus the next line of the same group replaces the unread one even at a sleeping recipient. The mark is a way to wait, not content: a repeat of the same id in another mode is admitted as the same entry, and a late `wake` wakes the thread with it.
