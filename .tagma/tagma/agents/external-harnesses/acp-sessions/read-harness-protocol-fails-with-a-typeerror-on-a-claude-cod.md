---
id: 01a15ed4-3d63-7ec3-ba38-8dc91cf52565
title: read_harness_protocol fails with a TypeError on a Claude Code ACP thread instead of answering
ord: 13
tags: ["reflection"]
fields:
  {
    "actual": "Execution error: \"undefined is not an object (evaluating 'result.holdings.length')\" — neither an answer nor a typed refusal.",
    "command": "read_harness_protocol {\"threadId\":\"01a15e6d-3b62-7149-83a8-187dd16e7926\"}",
    "expected": "An answer about the ACP session, the runner, the stdout read position, and the unanswered requests of the thread running on acp."
  }
---
Filed from project `runlith`.

The thread is Claude Code on ACP; at call time it had run 01a15ed0-cba5-7a38-85fa-78e70501aca7 going. The check was whether `session/cancel` went out on Escape; the door meant for that is unavailable.
