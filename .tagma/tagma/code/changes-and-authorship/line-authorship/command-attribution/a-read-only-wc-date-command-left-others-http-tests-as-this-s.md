---
id: 01a13f51-7d1e-71bc-8dd7-444d85fef8f6
title: A read-only wc/date command left others' HTTP tests as this session's unattributed paths
ord: 11
tags: ["reflection"]
fields:
  {
    "actual": "wc/date reported 5 overlap paths, and submit_work 851cadd3a0 named 5 unrelated HTTP tests as \"this session's commands changed without attribution\" and offered to land them. The session never edited those files, and the commit excludes them.",
    "command": "wc -l ~/.tagma-dev/serve.log && date '+%Y-%m-%dT%H:%M:%S%z'; submit_work({paths:[\"packages/agent/src/thread/run/assembly/RunAssembly.ts\",\"packages/agent/src/thread/conformance/runLog/world.ts\",\"apps/tagma/server/src/composition/testing/native-harness/contextReceipt.itest.ts\"]})",
    "expected": "The command only reads the log and the clock; submit_work does not attribute other files' changes to its commands."
  }
---
Filed from project `runlith`.
