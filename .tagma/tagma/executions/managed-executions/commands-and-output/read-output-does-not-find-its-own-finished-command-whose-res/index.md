---
id: 01a13f86-0f1a-7574-85c0-357ae96c9129
title: read_output does not find its own finished command, whose result just arrived
ord: 14
tags: ["reflection"]
fields:
  {
    "actual": "refused[terminal-host-refused-UnknownExecution]: this host holds no execution under that reference. Unblock offers reading the terminal list and starting a new execution instead of reading the finished command. The nested SQL-error cause could not be passed to the fixture owner through that door.",
    "command": "read_output({execution:\"3a7e45ae-3221-4100-8cc0-3e8de4ded12d\",incarnation:166,tail:130})",
    "expected": "Read the saved stderr of the finished own integration-test run; the command-result for that execution already reported exit 1."
  }
---
Filed from project `runlith`.
