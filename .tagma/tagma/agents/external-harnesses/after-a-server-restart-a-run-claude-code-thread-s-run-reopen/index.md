---
id: 01a16624-d717-7dee-8615-3f88715d8dc8
title: After a server restart a run Claude Code thread's run reopens with no claude process and hangs motionless
ord: 157
tags: ["reflection"]
fields:
  {
    "actual": "The run reopened at 00:07:46Z, the harness-run (terminal d759085b) alive, but no child claude process; 16 minutes motionless until the parent interrupted it by hand and called continue_agent",
    "command": "automatic continuation of run 01a16604-27e9-7cc0-81d4-30bf4dac83b9 of thread 01a16604-279b-7ef7-b708-105d9cb6a551 (harness:claude-code) after the server restart around 00:04Z 2026-10-23",
    "expected": "After a restart the run either keeps working with a live claude process, or ends with a restart reason so the parent continues it"
  }
---
Filed from project `runlith`.

The thread's last entry is a `write` in `input-streaming` state at 23:56:20Z. Activity: the 23:57:43Z run activity ended `cancelled/Interrupted` after 582 s, the next opened at 00:07:46Z and stayed `open`. `read_machine_load` at 00:18Z shows only `tagma harness-run claude-code` (349 MB) in the agent line with no `claude` pid, while neighbouring Claude Code threads have one. list_agents marked the thread `stalled since 23:57:43Z`.

A second roughness there: `interrupt_agent` on that thread answered `HttpClientError: Decode error (503 POST .../api/op/call_hosted_tool)`, though the interrupt went through — the run went `aborted` at 00:23:26Z. An error answer to a performed act.
