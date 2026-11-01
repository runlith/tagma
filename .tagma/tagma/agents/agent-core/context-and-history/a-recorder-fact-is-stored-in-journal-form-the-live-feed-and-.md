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
  - kind: file
    ref: packages/agent/src/thread/run/OpenParts.ts
---
A recorder fact is stored in journal form: the live feed and the journal carry one JSON document.

A run record leaves memory by two roads. Into the journal it travels through `JSON.stringify`, which silently drops keys with an `undefined` value. It enters the live feed as an open `put` frame carrying the object. The Effect 4 JSON codec of the socket checks `Schema.Unknown` fields strictly (`toolOutput`, `toolInput`, `display.result`, product records): `undefined`, `NaN`, or a class instance does not encode for it. Such a frame does not encode, and `RpcServer` ends one `thread.subscribe` subscription with a defect on a live socket.

TypeScript does not catch this. An optional field `x?: T` is compatible with a JSON type's index signature, and the `x: value` style puts `undefined` there. That is how the argument-refusal output and a `declinedBy` with an unstated note are built.

`ThreadFactQueue` and `OpenParts.tail` produce journal-form values with `toJson`, so live and durable roads carry the same document. Open-part snapshots own their entry objects; later growth replaces text rather than mutating a snapshot. Projection changes can therefore retain that snapshot without serializing the growing text again. The conversion preserves clean values by identity. `sameBesides` in `ThreadLiveFeed` treats a missing key and `undefined` as one, so cleaning a closed part does not turn its append into a whole-record replacement.

A tool's output is typed `StructuredValue` on the door roads and in `ToolOutcome`, so a raw value passes the compiler only through `toJson`. Conversion at each fact producer remains necessary: the type does not close the optional-field hole.
