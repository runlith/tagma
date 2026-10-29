---
id: 01a11ca5-7ddf-7f42-a891-bd5c10ac73a6
title: Transport binding, capability snapshot, model selection, and hosted agent — in the core row for native and acp
ord: 7
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a11c9a-6edb-7ed8-b517-60ad2121a95f
---
What: the "Binding, agent, and capabilities" sections of [[2121a95f]] and "Cut 1" of [[a63eba68]]. The thread's core row gains the `{adapter, profile, agent}` binding, a capability snapshot with the stall-threshold scalar, and the model selection; the `acp` facet loses `transport`, `hosts`, `proves`, and `asked`; `agentId` stays `harness`. Readers move onto the row: `capabilitiesOf`/`told` (`threads/harness/collaboration.ts`), `HarnessRegistry.served`, `sessions/model.ts`, `moves.ts:31`, `turns/rewinds.ts:77`, `native-harness/compaction/context.ts:17`, `context/actions.ts:62`, `rows/native.ts:249`, `collaboration/births.ts:177`, `CollaborationVoice.ts:341`, the picture check in `threads/turns/acts.ts`. `set_thread_transport` and `HarnessMoves` write the binding and the `transport` journal entry in one transaction. Database migration and a rollout-import step. Terminal threads stay on the current road until cut 3.

Proof: a migration test on a database with native, acp-hosted, and acp-vendor threads; rg over the listed places with no facet reads; typecheck; the affected tests.
