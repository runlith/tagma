---
id: 01a19710-6f70-7f70-8692-727e7ebdf960
title: A bash call queued behind a refused sleeps-only bash in the same step never starts, and blocks every later bash of the thread
ord: 152
tags: ["reflection"]
fields:
  {
    "actual": "read_calls shows the until-loop bash `waiting background … after bash` for 13+ minutes and the mkdir bash `waiting … after bash, bash`; neither started; control_call stop on the loop answered \"Stopped by the operator… had not started\" yet read_calls still lists it waiting",
    "command": "bash `sleep 40; echo` (refused sleeps-only) then, next step, bash `until [ -f …/serve.log ] …; do sleep 3; done` with waitMs 0, then bash `mkdir -p /tmp/tagma-try-muse-runner/…`",
    "expected": "The refused call ends at once, so the next bash calls start in turn; control_call stop ends a queued call"
  }
---
Filed from project `tagma`. Received by a server up since 2026-11-01T04:35:00.962Z, from b555dcaa0.

Thread 01a19562-2e91-73bd-ba7a-b645f8ba09ee, run 01a19562-30a3-71a6-8c81-90d490f6c34f, calls toolu_01UzTnmQMYbJe4onU1KRRF4p (until loop) and toolu_01Jkc6qfhcjZzynWU3HvTk78 (mkdir). The step before the until loop held a bash refused `sleeps-only` and a read_output refused `terminal-no-command`. read_commands for this thread's standing commands answered `(no commands)`, so nothing the queue could be waiting on is visible. Every later bash of the thread is blocked behind them.