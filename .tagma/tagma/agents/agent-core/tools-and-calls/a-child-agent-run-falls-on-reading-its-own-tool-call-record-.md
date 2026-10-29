---
id: 01a12145-3fc6-7ffb-918b-0fc2b5e38a10
title: "A child agent run falls on reading its own tool-call record: the extra toolDisplay.failed field"
ord: 19
tags: ["reflection"]
fields:
  {
    "actual": "Both runs fell with a thread stage: 'Persisted thread event entry cannot be read — Transcript entry tool:<id> of kind tool cannot be read: Expected no excess property at [\"toolDisplay\"][\"failed\"]'. In the second run it was already another record (toolu_01EakSXyjLEdbb9vw8YHweV8 after toolu_01PrdiSwYovtC45c1i77Gmit): every new call with a failed display breaks the flow again; continue_agent does not help.",
    "command": "send_task to the code agent (claude-sonnet-5-5) → run 01a1213e-b2ae-7fd9-88d5-795aed126ba1; then continue_agent → run 01a12142-6113-74d4-b23d-5621d2ea57; flow 01a12113-789c-7660-82ca-c6d6e2c42f9a",
    "expected": "The tool-call record the server itself stored reads back, and the run continues; continue_agent lifts the run over its history."
  }
---
The record writer puts a `failed` field into toolDisplay that the reader's schema forbids. The first run of the same flow (dozens of bash/edit calls) passed without failure; the second run fell on the task. Cost: two lost runs, the check unfinished, the agent's local environment (agent processes, DB configs) left mid-state.
