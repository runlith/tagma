---
id: 01a17acb-3a6d-7d10-bd31-4eb9c1a16fec
title: The notification calls the command's ending lost, though read_command reads exit 0
ord: 79
tags: ["reflection"]
fields:
  {
    "actual": "The automatic command-result reported \"This installation holds no ending for that reference\", but read_command at once read ended, exit 0, cleanup complete; that is the earlier git diff command, admitted 2026-10-26T22:54:50.413Z, not a test.",
    "command": "read_command({\"execution\":\"ff14bb6a-a1d4-4a9f-9034-9f2543c95212\",\"incarnation\":167}) after the automatic command-result about the lost ending",
    "expected": "The notification and read_command report the command's saved ending alike."
  }
---
Filed from project `runlith`.
