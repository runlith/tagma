---
id: 01a11b5e-918b-7fdb-80da-500a82c7c7b7
title: Rework load measurement, consumer expansion and targeted stop
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11b57-6798-7fc1-8eb8-93b3fe5f8f82",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a11b5e-918b-7fdb-80da-5009552ae607
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/LoadProcesses.svelte
  - kind: file
    ref: apps/tagma/server/src/executions/operations/machine.ts
  - kind: file
    ref: packages/execution-host/src/ProcessUsage.ts
---
Build one per-process CPU read on the execution host and carry it through the contract, server operations and Load. Drop the Other row as foreign load from the arithmetic remainder. Keep known descendants' provenance, add top-process reading and targeted stop with identity check.

Landed in `a37fb7cf70`: one account binds measured processes to an execution, install or known remainder; an unconfirmed link and the undecomposed difference show separately. Stopping a selected process rechecks scope and witness. The contracts explain [[4f7c55d5|accounting bounds]] and [[b8b6ac56|stop identity]].

Verified: typecheck of the executions and execution-host packages; 37 targeted host tests, 56 wire/session tests, 8 server tests and 6 app-tree tests. A native system test on macOS found a real CPU consumer and confirmed its end; a separate test covered walking the full population under a saturated sampling budget. Last warm sample on this machine: 650 processes, 432 CPU rates, a step of 24.832 ms CPU / 19.010 ms wall; this is one sample, not a portable cost bound.

An isolated server from the checkout, its own execution host and Vite passed a manual browser smoke: live account through the operation, the process table, command expansion, generic End and Stop work for the operator's work. Both one-shot processes' end was confirmed by state reads. Losing the connection showed Disconnected and hid fresh machine figures. The check server and Vite are stopped; after the stop the isolated host's socket was gone, the writer lock and ports no longer held. Fixture files remain in this session's scratch.

Full typechecks of the shared working copy aren't green outside this change: `composition/http/checkouts.ts:42` — `BunFile` doesn't match `FileLike.name`; `composition/testing/doorFixture.ts:147,160,188` — HTTP context with `HttpPlatform` doesn't match the fixture context; `features/opening/Preview.svelte:70` — `Type 'boolean' is not assignable to type 'string'`. No errors remain in the new Load consumers. There is an old `Conversation.svelte:173` warning about capturing the initial `host`.

Unproven: other OSes and full decomposition of macOS protected processes: the OS denies their CPU/RSS counters, and that stays an explicit measurement gap. No independent agent review ran, barred from delegating. The working install wasn't updated or restarted; activation is the operator's. The spec stays open until explicit acceptance.
