---
id: 01a118eb-3e7e-7085-8f2e-2cd99035b0a1
title: "A 100-thread tournament: linear bounds, a bench, and cost that does not grow with thread count"
ord: 15
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
Goal: one observer holds a 100-thread tournament — the [[9caf5753|poker]] form: 11 tables of 9 players, ~11 walking at once, ~10k decisions. Cost is bounded linearly and measured with a bench.

Model-call concurrency is not limited by anything — that is the operator's decision. Provider rate-limit answers are handled as today (`packages/llm`).

## Now

- **MCP.** Reconcile of every project server runs on each turn of every MCP thread, and `ping` before every call (`capabilities/mcp.ts:15-24`, `McpPool.ts:182-196,264-276`): two round-trips per decision.
- **Signal drain** costs a transaction and a scan on every step even when nothing arrived (`ThreadRunStarter.ts:600-671`).
- **Unbounded maps:**
  - live `AgentCalls` — only completed ones are evicted;
  - `ThreadSnapshots.published`;
  - Tagma `TouchMarks.ledgers`;
  - rule diagnostics.
- **Workflow:**
  - Tagma passes `conditions: {}` (`native-harness/kernel.ts:370`), and every `when` transition fails;
  - fan-out ≤ 64 (`workflow/definition.ts:26-39`);
  - exactly-once member birth after a crash rests on an unnamed `requestId` filler contract.
- **Heartbeats** in tournament form are no problem: they run only for walking runs, ~11, i.e. ~2 writes per second.

## What is built

- **MCP.** Reconcile only on server-declaration change. No `ping` before a call on a healthy session: a call failure itself discovers the dead session ([[13756ad0]], [[ab05dfec]]).
- **Signal drain** skips the transaction when no signals are present: the inbox knows emptiness without reading.
- **Maps** are bounded by their owner's end.
- **Workflow:**
  - conditions and seams are contributions ([[bb429da3]]), and Tagma registers its own;
  - fan-out above 64 with the same guarantee;
  - per-member deadlines;
  - member-birth idempotency is a named port contract with conformance.
- **Bench** `*.bench.ts` of the tournament with a fake model provider.
  - Measures store reads for report collection, wakeup and step, observer wakeups, observer transcript growth and live-map heap.
  - Runs on demand, outside `test` and `test:system`.
  - Linearity checks on minimal distinguishing sizes enter the integration layer within its budget ([[adb6798b]]).

## Acceptance criteria

- The bench with the same completion scenario — one by one and in a batch — counts reads, rows and bytes read, records processed, bytes sent and peak held work:
  - full collection grows O(C + R) in children and new reports;
  - warm repeated wakeup and the ordinary step read only the needed suffix;
  - cold build reads the needed materialized context once and is measured separately;
  - a team command on one changed child does not re-read;
  - bounds are set in those work units, and opening cost counts separately;
  - 100 threads is an extra tournament-form bench scenario;
  - after the tournament ends the live-map heap returns to base.
- A linearity integration test is on minimal sizes distinguishing linear from quadratic growth, in the layer budget.
- MCP test: a call on a healthy session is one round-trip, and a turn with no declaration change does no reconcile.
- Workflow test:
  - a `when` transition with a Tagma-registered condition executes;
  - 100-member fan-out passes;
  - a crash after member birth does not birth a second one.
