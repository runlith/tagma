---
id: 01a164b5-9dc2-7bd8-a4bf-465e5ee696d2
title: The birth note tells the child 'you hold no send_message' though it has send_message and the prompt tells it to answer through it
ord: 13
tags: ["reflection"]
fields:
  {
    "actual": "The note: 'you hold no send_message, so nothing of yours leaves this run before it ends…', while the child's tools include send_message and the Collaboration section of the system prompt tells it to answer with it",
    "command": "spawn_agent agentId tagma on claude-code/claude-opus-5-5 high from thread 01a163ff-c890-77a1-9b13-0dd3a3d0c9c2 → child 01a16492-1ce2-7432-9e89-e5afb0c4ac30 (report-fix)",
    "expected": "The birth note says the same as the child's catalogue: send_message with final: true, since the tool is there"
  }
---
Filed from project `runlith`.

The same pattern is described in the body of [[2e5941b2]] (thread 01a151cf-d5a7-771b-b2b2-9c12f6e1ece); here it repeated in thread report-fix.

A conclusion from code, unverified on this thread: `collaborationBirth` takes `messaging` from `child.capabilities.messaging`, while `recordOf` (packages/agent/src/collaboration/native/record.ts) puts it into `childReachesPeers` → `offeredSources(...).has('collaboration')`. The collaboration source in the grant is declared `narrowable` with the standing tools `send_message` and `read_models` (apps/tagma/server/src/native-harness/capabilities/definitions.ts, AgentDefinitions.derive), so a profile narrowing runtimeSources removes the source from `offeredSources` but leaves `send_message` in the catalogue. Then `messaging` is a second derivation of the fact "does the thread hold send_message", diverging from the catalogue; the closing rule, conversely, judges by `ctx.catalog[FINAL_ANSWER_TOOL]`.

Cost: a child believing the note never sends final and lays the outcome in the last message of the run the assignment opened.
