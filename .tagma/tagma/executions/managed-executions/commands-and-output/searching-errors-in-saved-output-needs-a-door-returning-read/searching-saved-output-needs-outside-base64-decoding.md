---
id: 01a14a91-dcab-7eb4-9cd1-0f2f7f99b2dc
title: Searching saved output needs outside base64 decoding
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "The command saved 964653 bytes of stdout. read_output shows the tail, and read_command_bytes gives base64 windows; checking for no skip needs a separate CLI/Python decode and byte-offset walking. The first straight scan of one window ended Incomplete retained output.",
    "command": "read_command_bytes({\"execution\":\"d6bc7f24-0c84-40cb-b59c-25ad794a0168\",\"incarnation\":167,\"stream\":\"stdout\",\"offset\":\"0\",\"limit\":0})",
    "expected": "Find skipped- and failed-test markers over the whole saved text output with one search query."
  }
---
Filed from another project.
