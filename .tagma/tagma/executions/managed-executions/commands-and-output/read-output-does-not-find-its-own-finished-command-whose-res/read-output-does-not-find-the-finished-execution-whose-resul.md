---
id: 01a13f8e-4d64-711d-9ec7-51703eb36d0c
title: read_output does not find the finished execution whose result the owner received
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "The door returned refused[terminal-host-refused-UnknownExecution]: this host holds no execution under that reference. Owner refl-law confirmed the same refusal of its read_output; the nested SQL cause stayed unavailable.",
    "command": "read_output({execution:\"3a7e45ae-3221-4100-8cc0-3e8de4ded12d\",incarnation:166,tail:170})",
    "expected": "Read the saved output of the finished run the owner named by command-result, with no rerun."
  }
---
Filed from project `runlith`.
