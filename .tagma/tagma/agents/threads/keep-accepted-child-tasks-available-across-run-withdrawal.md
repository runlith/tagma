---
id: 01a193f6-b5a6-7b27-880c-f9e668027cea
title: Keep accepted child tasks available across run withdrawal
ord: 144
tags: ["task"]
fields:
  {
    "holder": "tagma:01a193f6-f75d-7c61-9922-072c9d47d114",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a192d4-2a45-7ef5-b59d-42722879615c
---
Reproduce the send_task report where withdrawn runs consume the assignment while its request remains open. Fix durable delivery at the thread or harness owner, preserving one open obligation and task text across recovery. The native send_task regression failed before the fix because the accepted task text disappeared from history after stop(withdraw: true). It now proves two withdrawal requests and continuations, a further aborted turn, the same open inbox request, one copy of the addressed task and one final report closing the obligation. The changed file passed alone on seeds 1, 2 and 3; 34 tests across it, RunLifecycle, runLog/stops and historyMoves passed, as did the agent package typecheck. Recovery policy and already-withdrawn historical data are unchanged.