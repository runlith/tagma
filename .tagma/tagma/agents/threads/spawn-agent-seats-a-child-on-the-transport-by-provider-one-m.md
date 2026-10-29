---
id: 01a1360a-430f-780d-bb87-cb9f095bf8b5
title: "spawn_agent seats a child on the transport by provider: one \"model → seating\" decision for operator birth, spawn and model change"
ord: 51
tags: ["task"]
fields:
  {
    "holder": "tagma:01a135ff-d3a9-763a-a3d1-2efde8988952",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a11c9a-6edb-7ed8-b517-60ac9116e494
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/harness/births.ts
  - kind: file
    ref: apps/tagma/server/src/threads/harness/registry.ts
---
`spawn_agent` with a harness-served provider (`claude-code`) births the child on the native loop: the core row gets `provider: claude-code` and a native binding, the first run falls `NotInstalled`. Operator birth (`threads/birth/acts.ts`) and model change (`threads/harness/moves.ts`) each ask `HarnessRegistry.serving` and `serves.seat` on their own, while birth through spawn (`EngineBirths.record` under `native/threads.ts createOnce`) does not. The reflection is 6262c0c9 in the Tagma graph.

What to do: the "model and agent → harness seating or native road" decision with one owner — `HarnessRegistry.seat` — through which all three roads go; the old shape (`serving` at consumers and the CLI-provider refusal copy in `acts.ts`) is deleted. Spawn seats the child in the core's same birth record, so keyed retry, fork, name and place stay with the core.

Done in 21d4ad305a. Unproved: `spawnSeat.stest.ts` passed on the first shape (`seat(to, agent, models)`); after review the shape split into `seating(to, models)` + `seat(agent)` (a Devin thread with no hosted agent changes model inside its harness again), and the rerun did not load because of another session's unfinished edit to `packages/executions/src/protocol/evidence.ts`. ACP runs in `protocolHandover`/`protocolTransport` never finished on a tree with another session's ACP-protocol edits; carrying the model into `protocolHandover` passed meanwhile.

Proof: system test — spawn with a harness provider yields an `acp/claude/<child type>` binding and `agentId: harness`, with a native provider — a native binding; `protocolHandover.stest.ts` and affected tests pass; the server's `bun run typecheck`.
