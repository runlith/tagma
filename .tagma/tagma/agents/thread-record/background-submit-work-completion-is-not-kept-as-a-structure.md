---
id: 01a16f74-61c6-7409-b31e-157578ec2cac
title: Background submit_work completion is not kept as a structured tool outcome in thread reading
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "Tool entry at776 keeps status running; the signal at787 carries only rendered text with a 10-character hash. The Activity tool-call also holds the initial running. Across the whole tree75, successful background landings yield no typed carried; the exact count of carried peer lines cannot be established.",
    "command": "read_thread({project:\"runlith\",threadId:\"01a16f50-ac27-7545-b867-3f41680429fa\",select:\"entries\",where:[{field:\"toolName\",op:\"eq\",value:\"submit_work\"}],fields:[\"entry\"]})",
    "expected": "After the call completes, read its final structured submit_work result, including submitted.carried and the full commit, to measure the shared-checkout mechanisms."
  }
---
Filed from project `runlith`.

Example: thread 01a16f50-ac27-7545-b867-3f41680429fa, submit toolCallId call_865d25a909a64442aa5bc1510e7b16d4; entries at776 and 787, activity:01a16f60-90c6-77c0-bfa2-58a4e6ffe9f7 body2. A full sampling of root 01a16a94-8d3a-7610-abd9-8503665bc41f, reach tree set all, yielded 625 successful distinct commits: 550 structured outcomes, 73 signal completions and 2 wait_call completions. CLI/tool read_thread_record were read without source or DB. Read_calls by contract sees only its own invocations, not another thread's historical calls.
