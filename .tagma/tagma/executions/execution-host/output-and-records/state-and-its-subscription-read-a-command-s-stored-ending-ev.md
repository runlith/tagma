---
id: 01a16d83-b545-7118-bee6-4cc5aa7eb414
title: State and its subscription read a command's stored ending even when the logic's memory no longer holds it
ord: 12
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/execution-host/src/registry/commands.ts
    symbol: endUnacquired
  - kind: symbol
    ref: packages/execution-host/src/registry/inventory.ts
    symbol: summary
  - kind: symbol
    ref: packages/execution-host/src/subscriptions.ts
    symbol: states
---
The shelf and Live belong to one logic: after its change the native command's stored end stays in the same generation's store. State reads it together with custody and the call verdict, so the end notification and inventory never diverge; no record in memory never means a lost ending. After explicit deletion or eviction of the native command's record State stays empty. A stored end holds no input frontier: in such a summary the input field is absent, never promising zero taken bytes. Such a summary takes stream positions from the record's on-disk seal: without them an output reader lagging behind eviction would never learn the `retainedFrom` to continue from, nor `admittedCommand` where the stream ends. A child-acquire refusal likewise leaves the ending reason and custody with no Live and no shelf; setup ends after they are written, and the subscription delivers the final State before completed so the reader tells a launch refusal from a vanished execution.
