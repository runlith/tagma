---
id: 01a11b52-c68f-7d89-b48b-e9e01581046f
title: continue_agent answers 'failed and reported no message' although the child works after the call
ord: 12
tags: ["reflection"]
fields:
  {
    "actual": "Both calls returned The continue_agent tool failed and reported no message, while list_agents showed both threads working/running right after. The answer never says whether the call resumed the work.",
    "command": "continue_agent for two child threads after their runs failed with Transport/dns, retryable.",
    "expected": "The answer names the new run or a typed refusal with a reason (e.g., the thread already resumed)."
  }
---
Filed from project `runlith`.
