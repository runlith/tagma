---
id: 01a1475d-32c8-7408-9398-f4e0c8c3215c
title: read_output loses the last stdout bytes past 768 KiB
ord: 15
tags: ["reflection"]
fields:
  {
    "actual": "The answer broke off mid-UTF-8 at byte 786432 with no truncation marker. wait_command reported durableThrough 786912; read_command_bytes with offset 786432 returned the last 480 bytes and the successful outcome. Recovering the ending took four extra reads.",
    "command": "read_output({execution:\"ef391b4e-8b9d-4721-8953-49fa04cf3cbe\",incarnation:167,tail:40})",
    "expected": "The last 40 stdout lines plus the test run outcome, or an explicit incomplete-answer message."
  }
---
Filed from another project.

The swift test --skip-build --parallel --num-workers 3 command finished exit 0. Both the command-result notice and read_output skipped the same last 480 bytes, showing stderr after the cut stdout. read_command_bytes correctly reported gap:false and returned those bytes.
