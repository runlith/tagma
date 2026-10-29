---
id: 01a12bec-08ae-7b01-97fe-d868fd8aaeab
title: Reading a command's output refused stale authority before a fresh command read
ord: 16
tags: ["reflection"]
fields:
  {
    "actual": "Both reads refused terminal-stale-authority. Per the offered unblock two read_commands called; repeat read_outputs after that passed. 4 extra reads, though the execution and output stayed available.",
    "command": "read_output({execution:'9268afc5-25e2-43ff-923e-d34600a5efac', incarnation:163, wait:50}) and read_output({execution:'58457f42-caa1-4bf6-a69e-8f95b26606bc', incarnation:163, wait:50})",
    "expected": "Read already-accepted commands and their output without changing authority by reading; or show the actually changed policy."
  }
---
Filed from project `runlith`.
