---
id: 01a10284-da13-7e0c-9742-a426a7476322
title: Graph work on an agent step is law-revision reads, visible to telemetry — not a writing act under the tree permit
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10289-9e81-7d00-9d11-fe1c04b426ec",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/orientation/Instructions.ts
  - kind: file
    ref: apps/tagma/server/src/graph/orientation/reach.ts
  - kind: file
    ref: apps/tagma/server/src/graph/orientation/touches.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/composeAgent.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/touchRule.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/commandRules.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/delegationRule.ts
---
**What.** Graph work on every step and every agent file tool call costs O(law changes), runs as reads, and is visible to telemetry.

**Why (perf audit 2026-10-03).**
- The `project-instructions` rule (`composeAgent.ts:166-182`, beforeStep) calls `Orientation.instructions`, while `Instructions.ts:101-135` wraps it in `act.unit(writes('Orientation.instructions', []))`. On every step of every agent: `writeThrough.prepare` (FreshnessGate, `.git/index` stat, on shift — `git ls-files --unmerged`), the tree permit, the mirror's writer permit, `BEGIN IMMEDIATE`; inside — all of global law, the project's whole `lawForest` (156 rules), `reachOf`, `liveBlock` per rule (N+1), `tagText` and `sha256(JSON)` per tag and rule; on onCommit — `GraphFeed.flush`. Every agent's steps serialize with each other and with every graph write.
- `touches.ts:147-180` builds the whole `lawForest` per read/edit/write; the `reach.ts:24-35` cache keys on the project's newest `event.id` and resets on any graph write.
- Agent rules run through `Effect.runPromise` with no PerformanceTracer (`composeAgent.ts:170`, `capabilities/touchRule.ts:59`, `turns/commandRules.ts:29`, `turns/delegationRule.ts:15`): `Orientation.instructions` holds not one span of metrics over hundreds of steps, `harness.touch` spanless. Measured: `planStep 7861bc5ad079c765` — 5622 ms with 13 ms covered by children (instance 57f3a082).

**Direction.**
- Agent rules execute in the server runtime with its tracer — at the rules-hook owner, not wrapped in every rule.
- Instructions reads from the reader pool, with no Act.unit and no TreeGuard.
- The law set (forest, reach, tag texts) computes once per law revision — rule-, module-, and tag-block changes, their sources, and global law; the containerId N+1 becomes a batch.
- Reach law-delivery behaviour ([[19851665]]) never changes: revision/scope deltas and touch ledgers stay.

**Done when.** An agent step takes no tree permit and no writer; `Orientation.instructions` and the touch brief show in `read_performance` with their own spans; a graph write that never touches law recomputes no forest and no reach; orientation itests are green.
