---
id: 01a106df-ff2c-773d-958e-90022bb8514e
title: "`Finished` carries only the provider's condition; the session gives its own `Finished` only when no unconfirmed audio is left at the track's end"
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/speech/src/protocol/duplex.ts
  - kind: symbol
    ref: packages/speech/src/engine/session.ts
    symbol: Session
---
The duplex runner ends the event stream only with a `Finished` event, which the protocol step issues on the vendor's own condition; a socket closing before it is a `transport` break, and the session counts a connection whose events ended without `Finished` as broken. The session holds the deadline: in `client` mode it commits everything unconfirmed (`[committed, sent)`), sends `finish`, waits for `Finished` no longer than `finishMs`, and otherwise reports an `unconfirmed-tail` gap from the start of the unconfirmed audio (see the frontier rule in the budget note) to the end of that connection's audio.

One rule for both roads: the session gives its own `Finished` as the last element only when the track's end found everything confirmed — the last segment drained with `Finished` (or held no audio), no gap open; on the clip road, the last clip recognized. Mid-track losses (breaks, overflows, failed clips, drains on connection change) stay gaps and do not cancel `Finished`. The server listening's verdict stands on this: `completed` versus `interrupted`.
