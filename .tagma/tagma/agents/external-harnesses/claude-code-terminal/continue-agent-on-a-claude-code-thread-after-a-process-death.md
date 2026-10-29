---
id: 01a16b5c-5f99-759c-8b99-de240afb4351
title: continue_agent on a claude-code thread after a process death sends history ending in an assistant message, and the vendor refuses 400 prefill
ord: 13
tags: ["reflection"]
fields:
  {
    "actual": "A new run failed before model execution: InvalidRequest HTTP 400, not retryable — This model does not support assistant message prefill. The conversation must end with a user message.",
    "command": "continue_agent on a claude-code thread after a run that died with exit 130 (the server is starting).",
    "expected": "An interrupted run continues from saved history: the next model request ends in a user message (or tool result), as the vendor requires."
  }
---
Filed from project `runlith`.

Thread 01a16b08-ee15-7003-b5b6-d5dd064444b4 (kit), claude-code/claude-opus-5-5 xhigh, context ~528k. The first run died with code 130, stderr "[tagma] the server is starting; this call waits for its answer" — the agent process did not survive the server restart. continue_agent created a run whose history, judging by the vendor answer, ends with an assistant message (a cut-off turn). The refusal is marked not retryable, so a repeated continue_agent fails the same way; the workaround is a separate user message to the thread. The expected fix place: the continuation assembly on the claude-code transport (or the shared continue assembly) must close the cut assistant turn — append the cut call's result or a user continuation marker — instead of sending the history as is.
