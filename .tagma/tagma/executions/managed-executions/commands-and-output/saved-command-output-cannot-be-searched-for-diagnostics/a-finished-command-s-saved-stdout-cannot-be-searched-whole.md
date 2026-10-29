---
id: 01a1496b-ce16-7651-a36b-f63b7d1c3c13
title: A finished command's saved stdout cannot be searched whole
ord: 2
tags: ["reflection"]
fields:
  {
    "actual": "stdout holds 946947 bytes per read_command_bytes, but read_output and its complete-output file keep only the last 51474 bytes; both diagnostics come earlier. The byte reader returns base64 with no text search. Reading the diagnostics needed a repeated 9-second suite with XML output.",
    "command": "read_output({execution:\"2255e0b2-1712-4b48-a28c-0866165e81d2\",incarnation:167,tail:10000})",
    "expected": "Get the full text stdout or a path to it, so one grep reads both runtime failures without re-running the suite."
  }
---
Filed from project `<project>`.
