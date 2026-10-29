---
id: 01a15b88-2345-7b16-93d7-a2d1804045bc
title: "A hung ACP thread is not explained by Tagma operations: driver death, stdout read position and pending requests are visible only in serve.log and SQLite"
ord: 86
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15b88-e429-73d6-a7bb-5e1330521d6e",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a15b87-fd93-7648-ba16-03f4700ff263
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/attendance.ts
---
Finding the cause of the October 20 hang of thread `01a15ac1-2b9a-7fc6-b993-3b1f606e8186` took warnings in serve.log, the `protocol_session` row from SQLite (stdout cursor and the unanswered `_tagma/steer`), finding the runner execution by `launchedFor` in `read_terminals`, raw base64 stdout bytes from `read_terminal_bytes`, and the Claude Code private session journal — only it showed that Claude had ended the turn. Neither the thread, nor its run, nor the error list said anything. Do: driver death stands in the thread and on the run's activity with a reason; reading answers the thread protocol state — stdout parse position vs what the runner wrote, pending requests with age, session state — and names the runner execution.
