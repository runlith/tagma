---
id: 01a106e0-2c8a-722c-b9a9-e7f6df6c88af
title: The runner budget counts the pre-`ready` queue and the transport buffer together; the gap of a break, overflow or stop starts at the end of the last confirmed result
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/speech/src/protocol/duplex.ts
  - kind: symbol
    ref: packages/speech/src/engine/session.ts
    symbol: Session
---
Audio before `ready` accumulates in the runner's queue in order with commits and `finish`; after `ready` it leaves for the transport; both places share one duration budget (`DuplexLimits.budgetMs`, given by the session). The transport buffer measures in bytes and converts to frames at the size of the last sent audio frame, including one pushed from the queue: a vendor's frame may be base64 in JSON. A connection that did not become `ready` within `readyMs` is a `transport` break, otherwise it would overflow forever without counting as a failure.

Exceeding it is an `Overflow` refusal at `send`: the session closes the segment and opens a new one with the same chunk. The gap of a break, overflow or stop starts not at what reached the network (`delivered`) but at the confirmation frontier: the earlier of the start of unfinished turns and the end of the last stable result (the time of `Final` units, the range of a turn closed by `TurnEnd`/`TurnFailed`). Audio sent but unrecognized is loss too, and at vendors the result lags the audio by seconds. `delivered` stays the queue measure for the track's state; the consecutive-failure counter is reset by a provider event, not by delivered audio.
