---
id: 01a14da6-0543-79a6-bc98-168134de55e9
title: "Parity: a stop on the step boundary on an adapter run ends on the nearest boundary like native, not at the turn end"
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14cfa-01f6-7d00-af4d-7f2b2b1aecb7",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14d97-4e5c-7ee0-927a-45b079d15f81
  - kind: relates
    to: 01a14cba-e095-7bcb-bb6f-608245d13bf3
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/reactor.ts
  - kind: file
    ref: packages/agent/src/thread/run/RunBoundaries.ts
  - kind: file
    ref: packages/agent/src/thread/run/RunExecution.ts
---
A stop `at: 'step'` (a model move between roads, an interrupt on a step) on an adapter run waits for the turn end: the core cannot see vendor steps, and the adapter reports no checkpoint. Native stops on the nearest step boundary. The ACP adapter knows boundaries — a tool result, a `measured` request — and should answer a waiting step-stop by interrupting on the first of them, reporting the checkpoint to the core. Proof — the parity scenario "model move mid-text": the turn ends on one boundary on both roads.

## Outcome (120ea1255d, 5c982afba5)

- Core: `RunBoundaries` — the adapter step-boundary port. A step-stop on an adapter run waits for its `stepped` report (`AdapterReports.stepped`) and in its own fiber places a stop with no marker with the stop's own `by` and calls `interrupt`. Native `checkpoint` also places a stop on the boundary with no marker. An observed interruption with no `stoppedBy` ends `reader`.
- `acp`: the boundary is `ToolCallEnded` once the turn has no open calls. `ToolCallEnded` cuts a stdout portion, so the boundary is visible on its own frame. `ThreadHosting` no longer calls `checkpoint` after every hosted result: otherwise the first of parallel calls would stop the turn.
- Proven: the parity scenario "model move mid-text" (native and ACP: `aborted`, `by: model`, no row, partial text and the call result in the journal; on ACP the next call arrives in the same portion — without the portion cut the scenario hangs, verified); the `RunExecution` test: an adapter run stops on the reported boundary with the stop's `by` and no marker.

Not proven:
- the parity scenario waits for a step-stop registration by a fixed second: there is no observed fact of registration;
- parallel hosted calls of one request (the boundary after the last one) — no scenario;
- a `measured`-only boundary with no calls is not needed on Claude (a request with no tools ends the turn); not verified for other vendors.
