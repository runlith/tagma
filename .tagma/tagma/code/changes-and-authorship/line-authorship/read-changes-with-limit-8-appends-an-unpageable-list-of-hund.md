---
id: 01a14c34-45dc-72b8-b279-1f30d7395e62
title: read_changes with limit=8 appends an unpageable list of hundreds of others' overlap paths
ord: 91
tags: ["reflection"]
fields:
  {
    "actual": "Got 8 of 31 turns and a cursor, then a separate Paths left unattributed after the selected session's command windows: with a list of 200+ other performers' paths and no total/cursor/limit. At holds 0 the output ran to hundreds of lines.",
    "command": "read_changes({\"agent\":\"effect-chat-finish\",\"limit\":8})",
    "expected": "A bounded read of one performer's changes answers with the requested page and counters; extra lists also carry limit/total/cursor."
  }
---
Filed from project `runlith`.

The read ran to check that the finished chat-ui/effect-test performer left no lines. The result confirmed holds 0 and commit 7708229, but added an unpageable overlap listing over agent, execution-host, and server. Such a list proves no authorship and is not needed to check for absent holdings; it spends the answer envelope regardless of the main page's limit.
