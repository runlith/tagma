---
id: 01a0c96e-935e-7d13-99a7-61d2ffbc4eb0
title: "A refused tool call has two carriers: a flag nothing reads and the event that does the work"
ord: 124
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/agent/src/agent/turn/fold.ts
  - kind: symbol
    ref: packages/agent/src/agent/turn/tools.ts
    symbol: executeTools
---
`AgentToolOutcome` carries a `refused` field. The step's tool phase writes it in four places — a settled refusal, a preflight failure, an unanswerable call and a same-batch block — and nothing in the monorepo ever reads it. The fold branches on `executed` alone, and what actually keeps a refused call from reaching the wire as a result is the `tool-output-denied` event the phase publishes where the result would go.

The comment on the field is worse than the field. It describes the flag as the thing that makes a denial durable, which is a mechanism the code does not have; a reader who trusts it will look for a persistence path that was never written, and a later author may "fix" the denial road by writing the flag somewhere new instead of publishing the event.

Two honest endings. Either the flag is the right carrier and something should read it — in which case the event road and the flag road need reconciling, because two carriers for one fact is how they drift apart — or the flag is residue from a road that was replaced by the event, and it and its comment go together.

Done when a refused call has exactly one carrier in the code, and the claims under this area name which. Audit: the misleading comment on the field is already gone (e61f131533 moved the kernel's prose to the graph); what remains is the flag itself — still written in four places in `tools.ts` and still read nowhere (`AgentRunState.refused` is a separate field fed by `noteToolRefusal`, not this flag).
