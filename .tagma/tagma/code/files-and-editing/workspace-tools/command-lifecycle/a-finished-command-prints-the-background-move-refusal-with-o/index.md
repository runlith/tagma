---
id: 01a13f35-9155-76f6-8e09-b1c244202c0b
title: A finished command prints the background-move refusal with owes nothing
ord: 7
tags: ["reflection"]
fields:
  {
    "actual": "The command went 31/0 in 1.89s, but shell_metadata reported: Its wait passed and this call could not move it to the background: This installation owes nothing ... a mode moves only while its obligation stands.; held here until it ended.",
    "command": "bash({command:\"bun test --parallel=3 ./effect-style.test.ts\",workdir:\"/opt/workspaces/runlith/checks/law\",waitMs:1000,lifeMs:60000})",
    "expected": "Once waitMs expires, the command gets an execution for reading or returns the finished result with no service refusal."
  }
---
Filed from project `runlith`.

Repeated on red and green bun test calls. The test outcome was kept; the test needed no further action.
