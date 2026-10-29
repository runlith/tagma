---
id: 01a1320c-bcbc-718e-9263-4a2e2cabd9db
title: A child's final answer closes the task queued to it and not yet opened
ord: 12
tags: ["reflection"]
fields:
  {
    "actual": "After the final report the child went idle, list_agents no longer shows it among working agents, the queued-task report says nothing — the second task never opened; it had to be sent again (new runId 01a1320c-9104-799f-aad7-4ca3650fcfc1)",
    "command": "send_task(to: archive-perf, task: \"fix defect 5b6e8e72…\") while archive-perf was working on the spawn task; then archive-perf sent send_message(final: true) for the first task",
    "expected": "The final answer closes the task the child was performing; the queued task opens on its next turn"
  }
---
Filed from project `runlith`.

The first send_task answered status queued, runId 01a131f4-917e-7ced-a03d-d53e5087697f — the same run that was in progress. The send_message description says final closes every sender request the child holds — the not-yet-opened queued task likely fell into it. Cost: the operator waited for a fix nobody had started, and the parent had to notice the loss via list_agents.
