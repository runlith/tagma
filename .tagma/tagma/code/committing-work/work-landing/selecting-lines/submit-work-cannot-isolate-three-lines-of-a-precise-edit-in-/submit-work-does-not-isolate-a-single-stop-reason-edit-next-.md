---
id: 01a14c2b-827a-71ae-a1b1-88bfcafacb33
title: submit_work does not isolate a single stop-reason edit next to a foreign migration
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "refused[lines-held]: AgentRunner.ts has lines of 01a14c17-b1ec-77e1-b49d-4fb1178ad9cf inside the regions this landing would carry. It offers whole/taking of others' lines or excluding the file and waiting for their landing. Earlier the check was moved out of the large file because of walk-cut; now the single-line production edit itself is blocked.",
    "command": "submit_work({project:\"runlith\",subject:\"Preserve command recovery and stop causes on cancellation\",paths:[\"packages/agent/src/agent/door/ToolExecution.ts\",\"packages/agent/src/agent/door/ToolExecutionCalls.test.ts\",\"packages/agent/src/agent/AgentRunner.ts\",\"packages/agent/src/agent/AgentCancellation.test.ts\"]})",
    "expected": "Isolate the single own production line calls.halt(input.runId, reason...) by exact edit without the foreign migration."
  }
---
