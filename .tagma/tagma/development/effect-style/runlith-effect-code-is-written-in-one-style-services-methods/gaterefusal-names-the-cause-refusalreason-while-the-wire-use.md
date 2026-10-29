---
id: 01a13b4b-ca29-7c89-9742-c62ea6187cbc
title: "GateRefusal names the cause refusalReason while the wire uses reason: rename the field so the refusal encodes with refusalSchema and no manual projections"
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13b9a-e730-7096-a144-83656efc2e82",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13b37-5351-7e3a-bda9-f7c22e414755
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/contract/wire/refusal.ts
---
`GateRefusal` (`Data.TaggedError`) keeps the cause in the `refusalReason` field, while the wire `refusalSchema` requires `reason`: encoding a real instance fails with "Missing key reason". Hence no fewer than 35 manual projections in 30 files, five local `refused` helpers and an object-shape branch in `refusing` (`body.ts:153-154`). A `Data` class with wire fields encodes through `refusalSchema` unchanged (verified by a study on a test class).

To do: rename the field to `reason` on the class and everywhere (about 200 `refusalReason` mentions in 124 files), remove the projections and helpers made redundant. Proof is a `GateRefusal` instance encoding through `refusalSchema` directly, `bun check` and the touched modules' tests green.
