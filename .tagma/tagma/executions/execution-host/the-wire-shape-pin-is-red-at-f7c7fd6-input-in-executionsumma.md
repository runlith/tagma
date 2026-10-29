---
id: 01a17b21-ca84-76ce-abe2-9013d991cca0
title: "The wire-shape pin is red at f7c7fd6: `input` in ExecutionSummary went optional with no WIRE_VERSION bump"
ord: 46
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17b25-1345-7ccf-82c8-ba112cc40277",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17aff-0013-783e-93b0-82167556936c
sources:
  - kind: file
    ref: packages/executions/src/protocol/runtime.ts
  - kind: file
    ref: packages/executions/src/protocol/wire.ts
---
Commit f7c7fd6 ("Restore persisted command endings in host state") made `ExecutionSummary.input` optional; the previous release never reads a summary without it, and `packages/executions/src/protocol/wire.test.ts` "is pinned for the number the frames and the preface carry" fails at HEAD: measures `sha256:292f0b204093b3751ce6ee52f62d84c2d77b657a7be1a47650bb690c9786069a` against pin 40. Under the test's contract — raise WIRE_VERSION to 41 with a recorded corpus and PREVIOUS_RELEASE, or make the change additive.
