---
id: 01a10a1a-ee72-763a-942f-65ca6bfa7543
title: The ACP frame queue is written outside the transition lock; the cancel frame overtakes it and cuts off the turn's unwritten input
ord: 3
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1089e-978d-7423-bc88-3a1de25a0bbf
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/link.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/process.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/writing.ts
---
The execution has one sequential writer: it receives frames after durable write and writes them outside the transition lock. A separate fiber parses receipts under the lock, so the writer waits for neither stdout reads nor word assembly, and stdin under backpressure delays neither reads nor heartbeat.

`session/cancel` is its own lane: the frame jumps to the head of the queue and opens a new epoch. A frame gets its epoch at the start of the step that emitted it, not when queued: a step under the lock could have started before the cancel and finished writing after it, and its steer or reply would otherwise have reached the agent past the cancel. Turn frames from the past epoch — prompt, steer, withdraw, compact and replies to agent requests — are no longer written and come back as known unsent input (`Unwritten`). A turn frame being transmitted at that moment is cut between chunks: the writer closes its line with `\n`, the agent gets an unreadable line instead of the request, and the frame also becomes `Unwritten`. Only if the line could not be closed is the input undetermined (`Unknown`), and execution stops: the next frame would merge with the fragment. Session frames — open, setup — do not tear: one not yet started yields to cancel and re-queues, one started is written to the end. Cancels merge: while one waits for writing, the next only adds its turns to it. Refusal to write cancel itself stops execution without waiting for the retry window.

The `Admitted` receipt of the cancel frame is the kernel interruption receipt: on it the turn ends `aborted` without waiting for the agent reply. A cancel without `Admitted` does not end the turn: refusal or an undetermined write stops execution, and the turn is ended by its `Exited`, while `interrupt` answers `no-turn`. Receipts parse first in every step under the lock, before the step's own work: otherwise a stdout chunk that took the lock before the receipt fiber would have recorded the agent's late output into the already-interrupted turn. Without this lane, cancel would stand behind a frame with a picture of hundreds of KB, and under backpressure — up to 30 s.

At stdout end, unfinished receipts — an in-flight frame, a cut frame, and a cancel not yet written — parse to `Exited`: otherwise already-accepted bytes could wrongly return to the inbox as unsent. Unconfirmed requests do not retry automatically.
