---
id: 01a15e8e-7eaf-7a97-904c-11ed62960488
title: bash call near its life limit returned a 503 decode error instead of the command's result
ord: 10
tags: ["reflection"]
fields:
  {
    "actual": "The tool returned \"the Tagma server failed call_hosted_tool: HttpClientError: Decode error (503 POST http://127.0.0.1:5633/api/op/call_hosted_tool)\"; no command result arrived and three extra commands were needed to learn the inner process had been killed (KeyboardInterrupt in the log).",
    "command": "bash {command: \"timeout 57 python3 -u bin/collect_board.py > board.log 2>&1; echo exit $?\", waitMs: 59000, lifeMs: 60000}",
    "expected": "The command's own output (exit status from timeout and the log tail), or a background notice once the wait passed"
  }
---
Wait 59 s, life 60 s, inner `timeout 57`. The script ran about 57 s and was killed by `timeout`; the hosted-tool transport then failed with a 503 decode error instead of delivering the shell result. Thread 01a15e71-7f42-7b9c-8273-a8989b83ad88, 2026-10-21 ~15:01 local.