---
id: 01a11458-5706-7510-a89b-423a889f6a5b
title: "The ACP driver waits on thread state in one way: `ProtocolLinks.until` re-reads the link on a signal raised by every step under the lock, link removal, and row change without a link"
ord: 6
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a11401-0fc2-7ae2-9e45-3dab1b0cec2e
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/links.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/reactor.ts
---
Everyone waiting on ACP thread state — an aside reply, the cancel frame receipt on `interrupt`, the turn end on process stop and rewind, session readiness at start, compaction end, a call record for a hosted tool, the end of turn removal — waits through `until` with a predicate over the link. The driver parts have no `Deferred` maps of their own: a signal raised on one road would be lost for only its own map, and a row change on another road would wake the wrong ones.

The thread signal rises after every step under the link lock (`locked`), on link removal and after a stored-row change when there is no link (`ProtocolReactor.change`). So a state change outside these roads must call `raise` itself — otherwise the waiter sleeps through it until the next step; this is what turn removal does when it releases `settling`, and word preparation outside the lock (`ProtocolPreparing`) does when its guidance and attachments are ready. The signal is taken before the predicate is read, so a rise between reading and waiting is not lost.

Waiting does not hang on a dead session: when the predicate is not yet met and the link carries a refusal or a row failure, or there is no link and the session is ended or undetermined with no owner, `until` fails with `LinkEnded` carrying the session refusal. A deadline yields `WaitExpired`; each caller converts both into its own operation's refusal. The exception is waiting with `stored`: compaction waits until its run leaves `turns` and `ending`, and does not end on link refusal, because the run's real end comes later — with the `Exited` step or removal on the stored row. Without a link the predicate reads the stored row. Waiting for the removal end before answering words is bounded by a short deadline: removal includes settlement, and settlement itself can deliver words to another thread. Stop waits for the turn end on this same signal, not by polling.
