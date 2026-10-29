---
id: 01a153c2-c721-70c0-93b7-d88659e3f6ce
title: Opaque feed-record fields (toolInput, toolOutput, question data) are declared as JSON, not Unknown
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a153ba-faf0-72d8-91c8-25e8856a0ba8",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a153c2-404f-7fbc-8f26-4f6eb964468f
sources:
  - kind: file
    ref: packages/agent/src/transcript/entries.ts
---
After b964468f a feed record travels the wire in its kind's JSON codec, and every declared field translates to JSON by construction. Three `Schema.Unknown` fields remain in `entries.ts`: `ThreadToolEntry.toolInput`, `ThreadToolEntry.toolOutput` and `ThreadInteractionPrompt.data`. Their JSON codec only checks `isJson`, so a tool output holding `undefined`, `NaN`, a `Date` or a class instance still drops the thread-feed subscription's whole frame ("Expected JSON value at …["toolOutput"]"; such a failure is already covered in the `ThreadSession`/`ThreadPort` tests).

Do: declare those fields as `Schema.Json`, so TypeScript refuses non-JSON values at the producer (tool result, `ToolOutput`, `entries.ts#outcome`, foreign-harness calls, evidence), and record writing refuses by schema, not on the wire. Start at `packages/agent/src/transcript/entries.ts` and walk producer typecheck errors. Proof: a typecheck with no Json casts at producers, and a test in which a value with `undefined` inside toolOutput never reaches the wire.
