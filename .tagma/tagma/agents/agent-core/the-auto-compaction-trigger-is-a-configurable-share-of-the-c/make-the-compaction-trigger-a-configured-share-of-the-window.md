---
id: 01a0c56f-4b64-7bf3-bda7-e1d8e1875d3a
title: Make the compaction trigger a configured share of the window
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c53f-882c-7383-9d7a-862f5d9613c9",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c568-72b8-7820-9fc7-741d77beb2b0
---
The auto-compact trigger becomes a setting: a `percent` of the window (default 90%) or the old `reserve-output` formula as a mode. Three levels: user override per provider/model pair, row default in the model catalog, global setting.

To do:

- `packages/llm/src/models/description.ts` — `ModelSpec.compactionTrigger?: { strategy, trigger? }` field.
- `packages/agent/src/thread/compaction/policy.ts` — mode types, level resolver and both-branch formula; `threadUsableTokens` takes the resolved trigger.
- `packages/agent/src/thread/compaction/ThreadCompactionPolicy` — `compactionTrigger` and `compactionTriggerOverrides`.
- `packages/agent/src/thread/compaction/ThreadCompaction.ts` — both `threadUsableTokens` and `segment.usableTokens` sites; into the decision receipt `{ mode, value, source }`.
- `apps/tagma/server/src/protocol/settings.ts` — `agent.compactionStrategy`, `agent.compactionTrigger`, `agent.compactionOverrides` keys.
- `apps/tagma/server/src/harness/compactionPolicy.ts` — reading the three keys.
- Conformance log `packages/agent/src/thread/conformance/runLog.ts` and tests of affected packages.

Wire and model catalog unchanged: `maxTokens` on swe-2 stays 128,000.

Done when: `agent` and `llm` suites green, typecheck clean, formula and level-priority tests in place, `prepare` on devin/swe-2 yields 235,800, gpt-5.5 on openai-oauth stays 124,000.
