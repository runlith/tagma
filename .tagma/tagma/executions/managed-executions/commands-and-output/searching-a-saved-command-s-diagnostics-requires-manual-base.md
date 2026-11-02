---
id: 01a145a5-1879-7db2-b8ff-f01854f339ae
title: Searching a saved command's diagnostics requires manual base64 decoding
ord: 11
tags: ["reflection"]
fields:
  {
    "actual": "read_output gave the warnings tail with no error causes; the byte API returned 65,536 bytes as base64 in JSON of 87,930 bytes. Finding errors after several reads required jq -r .bytes <tool-output> | base64 -D | rg 'error:'.",
    "command": "read_command_bytes({execution:\"5386dd51-df4b-4ffa-a34b-892c369b953c\",incarnation:167,stream:\"stderr\",offset:\"10000\",limit:100000})",
    "expected": "Read or find the compiler diagnostics in the saved output without re-running the build."
  }
---
Filed from another project.

The byte API honored its contract, but saved streams have no text window by offset or content search. After a 2m43s Swift build it took several tool calls to find the diagnostics.
