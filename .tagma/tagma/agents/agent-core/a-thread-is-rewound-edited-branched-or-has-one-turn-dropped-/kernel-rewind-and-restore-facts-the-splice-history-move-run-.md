---
id: 01a0f262-5685-7e97-b058-bd0ba1b50e86
title: "Kernel: rewind and restore facts, the splice history move, run attribution, rewind/restore/preview verbs, branch-before, transcript marks and wire deltas"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f262-e9bb-7690-adc1-09fb970c1b5a",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f262-03db-7bb1-84f3-665d4263865b
---
Build §4.1–4.3 of the decision in `packages/agent`: the `rewound`/`restored` payload facets and the `splice` history move (HistoryFold, persisted schema, server-independent folds), the attributed log fold that finds a run's messages, `ThreadHandle.rewind/restore/previewRewind` (stop-first, queued turns and unread steers taken back, keyed by call), `ThreadForkCut { kind: 'before', runId }`, the transcript mark (`rewound: { by, scope }`) in the kernel transcript fold, the wire delta fields, cache warmth `invalidatedBy: 'rewind'`, and the collaboration tool `rewind_agent` plus `fork_thread { before }` over descendants. The preview's kernel part answers turns, draft text, runIds, live children spawned in them and tokens to rewrite; files and graph acts are the server's.

Start at `thread/HistoryFold.ts`, `thread/events.ts`, `thread/persisted.ts`, `thread/run/ThreadRunLedger.ts`, `thread/run/ThreadBranch.ts`, `transcript/eventFold.ts`, `thread/ThreadWireDeltas.ts`, `protocol/http.ts`, `collaboration/CollaborationTools.ts`.

Done when acceptance criteria 2–6 and 10 hold under the kernel conformance suites (`thread/conformance`), and the contract C and D build against is landed.