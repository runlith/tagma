---
id: 01a14015-8745-749e-bce6-a6e1b2aff5b4
title: send_task with compaction left a queued review behind a cut run with no notification to the parent
ord: 17
tags: ["reflection"]
fields:
  {
    "actual": "At 14:54:14Z a queued run accepted; compaction at920 aborted, run-end at922 cut 14:55:11Z, interruption at921: process driving run left 1 minute ago. Until 15:01Z review not started and no notification arrived; found manually via list_agents and 3 thread reads. send_task promises to open a task even if compaction did not run.",
    "command": "send_task({to:[\"ct-http-g1-main\"],compact:{keep:\"Next delivery — only six group6 CLI tests; read-only\"},task:\"Read group6-main-review.txt and carry out the server-authored review brief\"}) → run01a1400e-7fcb-7170-ae4c-1b525992b804,queued",
    "expected": "The task opens after compaction regardless of its result; a child's interrupted launch delivers a diagnosis to the parent."
  }
---
Filed from project `runlith`.

Child 01a13f3b-cd8a-7b50-a5f5-63d89ae3274b. Last durable entries 920–922 read with read_thread_record; last model message belongs to the former group 5. Full brief body handed over by path ~/.tagma-dev/scratch/01a13f2e-523d-71cd-acb6-4296368176de/group6-main-review.txt. Recovery: one continue_agent; the server not restarted by this session.
