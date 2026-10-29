---
id: 01a0cae8-7154-7684-90a7-e1455a1aa153
title: A spawned agent's final answer is never delivered as a report to its parent, and only a hand-read of its log recovers it
ord: 14
tags: ["reflection"]
fields:
  {
    "actual": "No report arrived. The child read as idle with its run `completed` and its answer standing as the last `message` entry of its log; the parent learned of it only by reading that entry with read_thread_record.",
    "command": "spawn_agent starts a zone-reviewer; the child's run completes and writes a final answer into its own log.",
    "expected": "The child's final answer arrives at the parent automatically as a report, opening a turn of the parent's."
  }
---
Filed from project `runlith`.

Measured across one zone of the cover by the sub-head that ran it: five occurrences in `packages/agent`, four of them recovered in a single pass — the collaboration, workflow, compaction and ports reviews, together 41 verdicts that the launcher had already written off as dead. One of them, `rev-collaboration` (run 01a0c97d), had spent 19k output tokens on an answer nobody received. The launcher had stopped and re-spawned reviewers seven times over what it read as delivery deaths, so the cost of the silence is paid twice: once for the lost answer, again for every replacement run.

The head of this cover met the same silence on the message road: a status question sent with send_message was answered into the child's own log and never opened a turn here. That half is [[bcbc65ec]]; this entry is the spawn/report road, where the contract says the report arrives automatically.

What makes it expensive rather than merely annoying is that the failure is indistinguishable from a child that died mid-answer: both read as a thread with no report. A launcher that trusts the contract concludes the run was lost and pays for another.</body>