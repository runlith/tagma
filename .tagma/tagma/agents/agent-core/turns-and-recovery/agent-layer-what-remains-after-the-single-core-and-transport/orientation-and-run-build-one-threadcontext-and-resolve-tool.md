---
id: 01a151df-e920-73d7-9b09-09d948aef83b
title: Orientation and run build one ThreadContext and resolve tool sources once
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15255-cadb-77a3-8733-c12b3e994855",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: packages/agent/src/thread/agents/ThreadAgent.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadHosting.ts
---
Orientation (`ThreadAgent.runContext`) builds a context and resolves sources (`supplied`, `agentCatalog`) for the deferred-tools inventory, then `startRun` builds a context and resolves them again (`packages/agent/src/thread/agents/ThreadAgent.ts:366–368` and `515–535`); MCP writes `mcpBound.bound` twice in the process. The hosted road repeats the same: `ThreadHosting.open` re-resolves sources and builds a turn context although the run build already holds the catalog (`thread/run/ThreadHosting.ts:630–642`). A ready contribution of one resolution cannot be handed to the other: `native-harness/turns/context.ts` resolves target, world and source roots by `use`, and orientation and run contexts differ.

Do: one context per run; orientation and the first-step catalog read it, the deferred-tools inventory is taken from the run catalog.

Proof: a test on the native and hosted roads: per run, skills and MCP resolve once (counter), and the deferred-tools inventory in the turn context equals the run catalog.

## Outcome

Done in `6452568c72`, one commit with the [[1e1ef4cf]] delivery: contracts are coupled both ways. `ThreadAgent.prepare` builds `ThreadContext` once per run, resolves sources (`supplied`) and the catalog (`agentCatalog` → `resolveCatalog`). `orient`, `start` and `host` read that one build; `AgentRunner` takes a ready `resolved`, and without one builds the catalog itself through `agentCatalog` as before. `RunAssembly.native` allocates `RunOutputs` before orientation and closes them on any failure before the handle. Hosted holds the preparation next to the handle, and each `ThreadHosting.open` orients on it. The `orientation` context kind and the `prepared` map in `WorkspaceInputs` are removed. The context boundary still builds a new generation. Fixed in the same delivery is the `library.itest.ts` fixture missed by `30723a8992` ([[a49da04b]]): `graph` at the context became an Effect.

Checked: agent and server package typechecks green on the pre-landing tree, check_law clean on the change. Tests: `ThreadAgent.test` (context and source counters on both roads, inventory equals the run catalog), hosting conformance (reopening a turn does not prepare the run again), run-log `turns` (one preparation per run; a preparation refusal closes the output scope exactly once), plus `composeAgent`, `library`, `storageMove`, `cache` and the remaining run-log suites.

Not checked: the typecheck of the exact tree that landed in the commit. Unfinished approvals-session edits stood in the working tree at landing time in `AgentHarness.ts` and `scheduler/intake.ts`, and a full agent typecheck failed on their rows with them. No live MCP or skills servers were started: resolution counting is proven on the `ThreadAgent` contract and the `RunAssembly`/`ThreadHosting` orchestration, without a real MCP process.
