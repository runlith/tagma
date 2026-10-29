---
id: 01a135fd-ecde-775a-8143-4b776262c0c9
title: spawn_agent with a harness-served provider (claude-code) births a thread on the native loop, and the first turn falls NotInstalled
ord: 6
tags: ["reflection"]
fields:
  {
    "actual": "The child born with a native binding and provider claude-code, first turn fell in 0 s: 'LLM.resolveModelCall: No installed adapter provides claude-code' (NotInstalled, non-retryable). Worked around via set_agent_model to the same provider/model plus continue_agent: HarnessMoves saw serving('claude-code') and moved the thread to ACP. Cost: one fallen turn and manual recovery for every ACP child.",
    "command": "spawn_agent {agentId: \"tagma\", provider: \"claude-code\", model: \"claude-opus-5-5\", reasoning: \"high\", task: …}",
    "expected": "The child born on ACP (Claude runner, acp/claude/agent tagma binding), as birth/acts.ts does via harnesses.serving and HarnessMoves on model change"
  }
---
Filed from project `runlith`.

Birth through spawn follows `packages/agent/src/collaboration/births.ts` → `native/threads.ts` `createOnce`. There the `judged` model written into the native line, and nobody asks `HarnessRegistry.serving(provider)`. Operator birth in `apps/tagma/server/src/threads/birth/acts.ts:195-218` asks `harnesses.serving(selected.provider)` and seats the thread through `serves.seat`, and model change does it in `threads/harness/moves.ts:168`. The spawn_agent schema offers `claude-code` models in its menu, i.e. promises they work. Thread 01a135fb-2d24-73fc-a435-5341421c30c5, fallen run 01a135fb-2d8b-7228-a489-0198d9638e61.
