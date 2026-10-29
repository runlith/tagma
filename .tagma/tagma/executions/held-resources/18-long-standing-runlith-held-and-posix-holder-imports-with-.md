---
id: 01a1355a-98f1-7263-acb8-249fde8f9728
title: 18 long-standing @runlith/held and posix-holder imports with no declared relation recorded as escaped of the import rule
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1355a-dec8-70e8-8b95-2968510837c2",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a132fb-f271-71b6-a5fa-df0c27cfd1e3
---
On re-measure of the import rule (13.10, after `set_module` on `@runlith/git` in 27cfd1e3), escaped recorded 18 long-standing violations: imports standing in code since late September – early October that no card declares a relation for, and the gate never saw because commits never touched those lines.

- `platform` (7 files: `platform/git/*`, `durable/flush.ts`, `watch/tickets.ts`, `contract/service/capacity.ts`), `@runlith/agent` (5 files in `thread/run`, `thread/transition`), `@runlith/executions` (`ExecutionClient.ts`, `WireRequests.ts`), `@runlith/execution-host` (3 files) → `@runlith/held` ([[c43d3272]]). Held is a dependency-free kit used by 31 modules with a declared relation; these four simply never got their relation recorded.
- `packages/execution-host/src/ExecutionRuntime.stest.ts` → `posix-holder` ([[921755ee]]). An `execution-host → posix-holder` relation would close a cycle (posix-holder imports execution-host): the system test of the built runtime belongs to the layer that binds them (execution-host build [[d2a60527]] or composition), not the host core.

To do: declare `imports → @runlith/held` on four cards via `set_module`; move `ExecutionRuntime.stest.ts` to the build owner (or make it a tests-relation where there is no cycle). Done when `read_enforcement 083d37f1` shows escaped 0 and `check_rules over: all` on the rule is clean of these 18.

Result: four imports declared, `ExecutionRuntime.stest.ts` handed to host-composition via file cut along the existing placement of build checks; path and code kept. `read_enforcement`: escaped 0; `check_rules over:all`: only the 5 previous debt. `bun run typecheck` successful. System run via `bun run test:system --test-name-pattern '^the live execution runtime'`: 40 pass, 2 fail, 45.12 s; lines 776 (`sources.stdout.completed`: true → false) and 867 (`ledger.executions`: 1 → 2) unproved, failures handed to the head of the final test check. Graph delivery — `2498a813a8`; `submit_work` answered nothing, since sources never changed.
