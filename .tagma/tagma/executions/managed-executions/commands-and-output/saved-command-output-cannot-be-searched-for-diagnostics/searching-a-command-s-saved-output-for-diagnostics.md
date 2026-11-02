---
id: 01a14679-9290-7ae0-b1b7-b05f248e1e0a
title: Searching a command's saved output for diagnostics
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "read_output reported 155,978 unread bytes before the tail; the available byte reader returned 9000 bytes as base64. There is no search door over saved output; one diagnostic required separately reading metadata/bytes and matching the line against the current source. Four extra reads after the command finished.",
    "command": "read_output({execution:\"8ed301e4-369e-40ea-8708-e976460b4531\",incarnation:167,tail:140}); read_command_bytes({execution:\"8ed301e4-369e-40ea-8708-e976460b4531\",incarnation:167,stream:\"stdout\",offset:\"0\",limit:9000})",
    "expected": "Find the first compiler error line in a finished command's saved output with one text search operation."
  }
---
Filed from another project.
