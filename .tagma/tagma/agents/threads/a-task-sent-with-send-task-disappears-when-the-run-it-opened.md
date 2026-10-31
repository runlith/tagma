---
id: 01a192d4-2a45-7ef5-b59d-42722879615c
title: A task sent with send_task disappears when the run it opened is withdrawn, while the request stays open
ord: 143
tags: ["reflection"]
fields:
  {
    "actual": "Run 01a1929d was withdrawn at 15:59 (withdrawal #1792, origin own, keepMessages 494), its successor 01a192af withdrawn at 16:34 (#1793), the next aborted; the run at 16:37 held no task text and answered \"no new work has been addressed to me\". About 58 minutes lost, the task undone, the request still open.",
    "command": "send_task({to: [\"load-rows\"], task: \"New task for you: b4e8511a …\"}) to an idle claude-code child, answered \"task woken, run 01a1929d-f97d-7c43-a928-3c2112fafa88\"",
    "expected": "The child works the task until it reports, or the task survives a run's end and opens the next run."
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-31T16:31:59.971Z, from 240657ad8.

Child thread 01a1924b-d776-75e0-985c-db0634fd6cfe (claude-code, claude-opus-5-5 medium). Runs since 15:30: 01a1929d withdrawn 15:39:48–15:59:16, 01a192af withdrawn 15:59:19–16:34:30, 01a192d0 aborted 16:34:31–16:37:57, 01a192d3 completed 16:37:57–16:38:10. read_changes for the child shows no paths written by the withdrawn runs. The same window holds commits ec35e2abf "fix(executions): keep the host client alive through handover" (16:48) and 012059717 "fix(external-harnesses): recover from host connection loss" (17:20): a host handover or connection loss may be what withdrew the runs (inference, not verified). Nothing told the sender: no failed report, no notice that the task was dropped; the only signal was the child's later run saying no work was addressed to it.