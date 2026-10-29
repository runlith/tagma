---
id: 01a0c972-7d69-77f2-a3b2-f53bfedfe7e5
title: The promise face hands back a native tool door, so a caller with no Effect runtime receives verbs it cannot run
ord: 139
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/agent/src/promise/index.ts
  - kind: symbol
    ref: packages/agent/src/thread/AgentHarness.ts
    symbol: toolDoor
---
The promise face exists so a product with no Effect runtime can hold the kernel: every verb that answers an effect answers a promise instead, and every declared failure arrives as a throw. `harness.toolDoor` breaks that.

It is declared as an effect whose success value is the native `AgentToolDoor`, and the promise face lifts the call without lifting what the call returns. So a promise-only caller awaits it successfully and is handed an object whose own verbs — preflight, approved and the rest — are Effects it has no runtime to run. The failure is not a refusal it can read; it is a value it cannot use, discovered at the call site rather than at the boundary.

That the shape was understood is visible two lines away. `thread` has the same problem — a verb whose result needs lifting as much as the call does — and it is special-cased by hand, returning a lifted handle. `toolDoor` was not given that case. This is an omission in a hand-written list, which is exactly the failure a hand-written list invites: the proxy derives verb calls, and anything the mapped type cannot carry is written out beside it, so a verb added or reshaped later is covered only if someone remembers.

Two endings. Lift the door's own face as `thread`'s is lifted, so the promise surface is closed for the verbs it declares. Or declare the door out of the promise face entirely and refuse it there, so a promise-only caller is told at the boundary instead of receiving something unusable.

Done when no verb reachable from the promise face answers a value carrying Effect members, or the ones that do are refused at the face rather than returned — and the claims under the promise area state which rule now holds.
