---
id: 01a1355d-ee55-71ed-a37f-51060a4afbc0
title: "ExecutionRuntime.stest fails two tests: stdout unfinished after stop, capacity not freed by a finished execution"
ord: 25
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1355e-107a-76fd-885a-f282f7b32a6d",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1355a-98f1-7263-acb8-249fde8f9728
sources:
  - kind: file
    ref: packages/execution-host/src/ExecutionRuntime.stest.ts
---
`packages/execution-host/src/ExecutionRuntime.stest.ts` on main (13.10 ~15:05) fails two of 42 tests (`bun run test:system --test-name-pattern '^the live execution runtime'`, 45 s; full output — execution eda1a71a-7b09-4054-834d-f39d0f4ceb0f:163 of the module-relations thread). No uncommitted edits under `packages/execution-host`; the latest commits touching host/executions: 17574b9100 (only `executions/src/conformance/hostConformance.ts`), f928188c62, 39035be8b2 "Preserve streaming output under bounded retention".

- `:776` — after `explicit-stop` with `destroy` the call answers `Settled/Decided/Cancelled`, but `result.sources.stdout.completed` = false (true expected): either stop loses the stdout stream's completion or the test holds the old contract.
- `:867` — after a `/bin/echo` call execution finishes with a second one live, `capacity.ledger().executions` = 2 (1 expected): a finished execution never frees its capacity-accounting slot, or frees it later than the test reads.

Fixed in `b25c1b7014`: the stdout test took the leader's exit for EOF, although Cancelled is available until drain; the wait now checks the sources' actual boundary. `Completed` was issued before capacity return after the `e11d198edf` change; the answer now awaits finalization. A permanent post-stop leak found and removed: `ended()` returned undefined for an already complete receipt, so finalization skipped the release; the owner now returns the live measurement and joins the running one. Scope completion wakes the awaiting result even under concurrent retirement, and vanished live state reads from the store. Three deterministic red-before-green scenarios confirmed the early Completed, the post-stop release skip and the retirement hang. Totals: 43/43 system in 38.91 s, 21/21 integration across seven touched files in 13.78 s, `bun run typecheck` and diff check green. One Sol xhigh round plus two Muse xhigh lenses; confirmed races fixed. The live server and its host were untouched.
