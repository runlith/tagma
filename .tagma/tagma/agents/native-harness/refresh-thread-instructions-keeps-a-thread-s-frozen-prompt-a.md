---
id: 01a14bdd-8467-787d-9a76-ee6105c2c634
title: refresh_thread_instructions keeps a thread's frozen prompt after its agent definition file changed
ord: 37
tags: ["reflection"]
fields:
  {
    "actual": "status `current` on all three oracle threads. Only the pending #feature tag entry showed, and the overlay edited a minute before stays frozen. To give running agents the new role text, the operator must restate it inside a task.",
    "command": "edit ~/.tagma-dev/agents/oracle.md (overlay text changed), then refresh_thread_instructions {threadId: 01a14bab-2046-738b-ae9c-75e5c7ab7636} on a thread of type oracle",
    "expected": "The frozen system prompt is rebuilt from the current definition: status `updated`, so the next run carries the new overlay. The operation says it brings a thread up to the instructions this server holds."
  }
---
Filed from project `runlith`.

The A1 feature record 2ce92792 and the agent-library record cad90fdf say that definition changes apply to the next thread. So this may be a deliberate boundary. If it is, the refresh description should say that the agent definition is not re-read. Today the operator and the agent both read `/refresh-instructions` as the act that delivers an edited definition to a running thread.