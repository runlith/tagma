---
id: 01a12f9e-80f1-7ed1-92f3-cfa80ee6585c
title: "A recorder fact is stored in journal form: the live feed and the journal carry one JSON document"
ord: 4
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12f88-66ed-7306-9d96-db5a9ea5cde8
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadFactQueue.ts
  - kind: symbol
    ref: packages/agent/src/thread/run/ThreadLiveFeed.ts
    symbol: sameBesides
---
A recorder fact is stored in journal form: the live feed and the journal carry one JSON document.

A run record leaves memory by two roads. Into the journal it travels through `JSON.stringify`, which silently drops keys with an `undefined` value. It enters the live feed as an open `put` frame carrying the object. The Effect 4 JSON codec of the socket checks `Schema.Unknown` fields strictly (`toolOutput`, `toolInput`, `display.result`, product records): `undefined`, `NaN`, or a class instance does not encode for it. Such a frame does not encode, and `RpcServer` ends one `thread.subscribe` subscription with a defect on a live socket.

TypeScript does not catch this. An optional field `x?: T` is compatible with a JSON type's index signature, and the `x: value` style puts `undefined` there. That is how the argument-refusal output and a `declinedBy` with an unstated note are built.

So `ThreadFactQueue` stores every fact already in journal form (`toJson`), and both roads carry the same object. For an already clean value `toJson` returns the same object, copying nothing. `sameBesides` in `ThreadLiveFeed` treats a missing key and `undefined` as one: otherwise a closed part would have left as a whole record instead of a tail append.

A tool's output is typed `StructuredValue` on the door roads and in `ToolOutcome`, so a raw value passes the compiler only through `toJson`. The queue remains the feed's guarantee: the type does not close the optional-field hole.
