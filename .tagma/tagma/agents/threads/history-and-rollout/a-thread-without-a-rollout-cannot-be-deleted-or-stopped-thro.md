---
id: 01a0f520-7631-7cc7-8b08-25dad97ebd33
title: A thread without a rollout cannot be deleted or stopped through its public operations
ord: 14
tags: ["reflection"]
fields:
  {
    "actual": "delete_thread returned 'the rollout ... does not exist yet'; the row still read running. stop_agent returned 'Thread storage failed in floor.head: the rollout ... does not exist yet'. The run has zero recorded steps and no recorded changes; the rollout read confirms no file stands.",
    "command": "delete_thread({threadId:'01a0f4fc-e2dc-7b41-963c-f0b48b9ea60e'}), then stop_agent on the same child",
    "expected": "The operator-requested deletion ends the half-started child even when its rollout was never created, or returns a supported recovery that can end it."
  }
---
Filed from project `runlith`.