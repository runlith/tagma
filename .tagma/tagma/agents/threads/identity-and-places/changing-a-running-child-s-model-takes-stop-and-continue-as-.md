---
id: 01a12ae6-0874-7299-947a-7fc9eccb139f
title: Changing a running child's model takes stop and continue as separate calls
ord: 9
tags: ["reflection"]
fields:
  {
    "actual": "thread-running: stop it first, then move it and continue it. Moving three children took stop_agent → set_agent_model → continue_agent for each.",
    "command": "set_agent_model({threadId:<working-child-id>,provider,model,reasoning})",
    "expected": "One call stops the current turn at a step boundary, changes the model, and continues the same turn over the saved history."
  }
---
Filed from project `runlith`.
