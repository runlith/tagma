---
id: 01a165bf-9470-73af-bb5e-ecdee2a7ddd4
title: submit_work was cancelled with “agent harness was disposed” during an instructions update
ord: 146
tags: ["reflection"]
fields:
  {
    "actual": "The door returned “cancelled: The agent harness was disposed. executions: []”; the #rule announcement delta arrived right after. read_changes kept 22 held paths; git log shows no delivery commit.",
    "command": "submit_work({subject:\"Preview and report changed inspection descriptions\"})",
    "expected": "The landing answers with a result or a structured refusal; an instructions update does not lose a started call."
  }
---
Observation in the config-tighten thread after passing typecheck, tests, and review. The cancellation is not a graph refusal: no reason, code, or unblock was returned. The link to the instructions update is inferred from neighboring events; the cause was not investigated in the sources.
