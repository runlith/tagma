---
id: 01a16900-0bf8-7171-9122-e1b8ab91b910
title: "invocation writes an operation call's defect at the call site: under the calling thread's run, on the addressed thread, or in the calling project"
ord: 12
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a155a6-09b6-71a7-80be-ea4045b94111
sources:
  - kind: symbol
    ref: apps/tagma/server/src/invocation/cause.ts
    symbol: callDefected
  - kind: symbol
    ref: apps/tagma/server/src/invocation/perform.ts
    symbol: performByIdIn
---
A call arriving over HTTP (the app, MCP, `tagma op`, plugins) or over the socket runs through `performByIdIn`, and invocation itself writes the defect ending it at any step — place and admission, `prepare`, approval, `execute`, response projection (`display`, outcome), media, and voice — with the context only it knows. A store failure (`StoreFailure`) ending the call becomes a defect inside the call, not at the door (`refusing`): otherwise it would become a defect outside the context. Before, the door wrote the defect — a `server call` with no thread, run, or project — and the guilty thread was searched by enumeration.

A fault opens with a place — the operation id, the actor and trigger of the call — and this record entry:
- a calling thread — its thread, under its current run (`CallStanding.runId`), if a run is in flight;
- the operator, a foreign caller, a session — the thread the call addresses, if there is exactly one subject thread; the id comes from the owner's canonical answer (`SubjectPlace.canonical`) from the place's call context, without a second read. The fault lands in that thread's record, and `read_thread_record` opens it at the activity address;
- otherwise — with no thread, in the calling place's project (`CallPlace`); the broken place gives the project admitted by the door.

The door writes only its own steps' defects (`doorStep`: parsing and decoding the entry, encoding the answer, the background receipt; at the socket — admission and the feed projection), and its shared catch (`answeringRecorded`, `CallLog` for verb-operations) only answers 500 and logs. So a defect primitive (`Effect.die('…')`), which `fault.ts` does not recognize by identity, lands in the list once.

There is no separate activity per call. An operator call's line in the addressed thread's record would make a thread the operator merely read active in `read_thread` (`active`) windows and would mix reads into its activity; a calling thread is visible by its `tool-call` entries as is. The price: a defect that an inner activity without a thread recorded first carries its context, not the call's ([[8c0ddf3f]]). The native door does not belong here: its call stands inside the run's `tool-call`.
