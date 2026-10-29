---
id: 01a13d32-02b7-73b4-b926-4103653e36c3
title: Wire failures are declared as schema values, internal errors as Data.TaggedError
ord: 28
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c17-b1ed-7b23-864a-44198f63889a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d2f-397e-77cc-90c3-6f03bdb21bcd
sources:
  - kind: file
    ref: packages/executions/src/protocol/terminal.ts
---
The wire shape is declared via `Schema.TaggedStruct` or `Schema.Struct` in a union at the boundary's owner; an internal error is a `Data.TaggedError` with one projection at the boundary. `packages/executions/src/protocol/terminal.ts` `ForegroundRefused` belongs to `ForegroundAnswer → HostAnswer → HostMessage` but is declared `Schema.TaggedError` (found in bdb21bcd). Migrate its wire shape and the consumers using it as an error; first name the other confirmed wire classes to the operator. The `schema-tagged-error` check keeps the shared contract with no exemptions or catalog parameters.

Proof is the foreground refusal's wire round-trip, typed failure kept at the internal owner, green checks of the touched packages; `ForegroundRefused` is no longer found as `schema-tagged-error`, internal `Schema.TaggedError`s are still judged.
