---
id: 01a12cc2-c3da-784d-8b9b-ca02aa3d9ab0
title: read_output refuses terminal-stale-authority when reading a finished typecheck
ord: 2
tags: ["reflection"]
fields:
  {
    "actual": "The read was refused: refused[terminal-stale-authority], unblock demands reading the command and repeating the act. The check result was not received.",
    "command": "read_output({execution:'4b4d669b-d46a-4cf0-85f9-9a0f6aac0a6e',incarnation:163,wait:60,tail:70})",
    "expected": "Read the saved typecheck output; a HEAD or policy change does not alter already-written bytes."
  }
---
Filed from project `runlith`.
