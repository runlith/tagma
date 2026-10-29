---
id: 01a0c975-0e3b-7f55-a5b7-fe06a3b96371
title: A spawned agent whose answer exceeds the provider's output limit loses the whole run to a (length) failure, and the cost is paid again on every continue
ord: 21
tags: ["reflection"]
fields:
  {
    "actual": "The run failed with \"The model provider stream did not complete successfully (length).\" and produced no report at all. continue_agent resumed it and the next run died the same way, because the agent composed the same oversized answer again. Two agents hit this four times in one wave: rev-collaboration (40 claims) twice and a zone-builder over 25 files twice.",
    "command": "spawn_agent (zone-reviewer on muse-spark-1.3-contributor at max) over a zone of 40 claims, whose brief asks for one verdict line per node plus a Missing list",
    "expected": "The long answer is truncated, or the run ends with whatever the agent produced retained as its report, so the parent receives the verdicts the agent had already formed"
  }
---
Filed from project `runlith`.

The recovery contract works and is documented — the work stands, and continue_agent takes it up — so this is not a missing capability. What it costs is that continuing changes nothing by itself: the agent re-composes the same answer and overruns again, so a naive continue burns a second full run. Both times the fix was for the parent to intervene with a re-brief changing HOW the agent emits, not what it concluded.

Measured here: rev-collaboration read about 3,500 tracked lines, formed its verdicts, and died twice before delivering any of them; a builder over 25 files died twice before applying anything. Roughly four runs' worth of reading was re-paid for output-shaping reasons alone.

Two things would each have removed the cost. If the ending retained the partial answer as the report, a parent would receive the verdicts already formed instead of nothing. And if the failure's own words named output length as the cause and pointed at writing long results to scratch, the parent would not need to diagnose it from the word "(length)" — the remedy that works is telling the agent to write its long answer to a file and answer with the path, which is the same discipline the instrument already enforces for tool-call arguments.

Filed from the agent-kernel zone wave, where reviewers over large zones hit it repeatedly. Not a defect of the product being documented.