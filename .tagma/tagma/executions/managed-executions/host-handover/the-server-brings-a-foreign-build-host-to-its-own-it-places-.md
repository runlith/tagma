---
id: 01a12a42-fb35-7994-979f-16490123fde2
title: "The server brings a foreign-build host to its own: it places the candidate and asks the logic to yield by signal"
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/children.ts
  - kind: file
    ref: apps/tagma/server/src/executions/host/foreign.ts
---
The server talks only to its own build's host, so a foreign-build host with a held writer claim — after the death of a successor that restored the old build, after a failed handover, or on a cold start — would otherwise stay unreachable until the next restart.

- **The road.** On a cold start the server places its own bundle as candidate with the same `placeCandidate` as the successor at stage 1. The platform signal to the logic named by the `{pid, birth}` witness from registration is sent by the own-digest logic wait ([[ce39be5f]]) — identically on cold start and after restart, once per witness.
- **The witness.** The signal goes only on a matching witness, so a pid taken by another process gets no signal. The logic writes the witness itself on every start; logic with no witness (a build before this road) is never signaled.
- **The port.** The kernel declares `LogicYield`, and composition binds it to the execution-host platform adapter. A witness that is missing or whose pid another process took answers `Gone`; no native library means no signal: that is an `Unasked` answer with a cause.
- **The refusal.** The logic checks the candidate with the same checks as preparation. It writes a refusal naming that candidate to `bundle.next.refused`, and the server drops the candidate and names the refusal in the host state. A logic of this build asked to yield to a candidate whose chain lacks its store's migrations prepares it and returns the store onto that chain as it leaves; a logic of an earlier build refuses such a candidate and stays with its own build's server.
