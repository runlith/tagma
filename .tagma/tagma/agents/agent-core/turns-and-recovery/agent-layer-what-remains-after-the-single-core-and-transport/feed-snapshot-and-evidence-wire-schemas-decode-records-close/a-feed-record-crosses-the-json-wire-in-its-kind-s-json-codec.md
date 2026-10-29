---
id: 01a153c2-404f-7fbc-8f26-4f6eb964468f
title: A feed record crosses the JSON wire in its kind's JSON-codec form, not as a raw memory value
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a153ba-faf0-72d8-91c8-25e8856a0ba8",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a151df-e920-73d7-9b09-09de86120678
sources:
  - kind: file
    ref: packages/agent/src/protocol/http.ts
  - kind: file
    ref: packages/agent/src/transcript/kinds.ts
---
After 95de2c67f3 `threadEntryWireSchema` encoded a record as `Schema.Unknown`: RPC serialization through `toCodecJson` checks such a value only with `isJson`, so a record with an optional `undefined` key (an allowed `Schema.optional` form) dropped the whole feed subscription frame — "This thread could not be read" — until a resubscription brought a snapshot without that record. Fix: the kinds reader supplies `readWire`/`writeWire` through the kind schema's `Schema.toCodecJson`, and the wire encodes and decodes records with them. Proof is a test in `entryWire.test.ts` running a record with `undefined` through the `threadOpenChangeSchema` JSON codec.
