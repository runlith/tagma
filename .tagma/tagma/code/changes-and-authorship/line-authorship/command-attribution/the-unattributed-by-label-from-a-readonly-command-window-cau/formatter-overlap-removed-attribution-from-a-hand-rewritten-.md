---
id: 01a14025-3ef3-72ce-9092-6bd1295e67b1
title: Formatter overlap removed attribution from a hand-rewritten test
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "After write+formatter this session has only +2/−1 on the test, while +60/−51 are attributed to nobody because of overlap with command 01a13fd0-aafb-7c4c-bb78-cce3611ba91a; landing needs explicit paths whole:true.",
    "command": "read_changes({path:\"packages/agent/src/thread/compaction/ThreadRequestMeter.itest.ts\",limit:10}) after bash(\"bunx oxfmt --threads=1 --write packages/agent/src/thread/compaction/ThreadRequestMeter.itest.ts\")",
    "expected": "Keep the write session's authorship for a hand migration and apply formatting to the same lines."
  }
---
Filed from project `runlith`.