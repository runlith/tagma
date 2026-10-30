---
id: 01a18a44-d114-7536-8521-4951015b7e44
title: Restore an MCP run snapshot after its server reconnects
ord: 67
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18a3c-ddfb-7d40-866b-4b396cc09849",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a14c38-51a1-79f0-a6e6-0a6d3c8bfdcd
  - kind: discovered-from
    to: 01a15063-6fba-7825-b987-3cf539796dd6
---
The pool now publishes a stable revision of its available tool catalog through McpServers, and the native capability reassembles on that revision. Native bindings retain each project's first-visit membership for the current thread/run: disconnect removes its available subset, reconnect restores it after a context rebuild or a project round trip, and new names wait for the next run. The public native regression failed before the fix on the missing restored tool and passed afterwards; the same regression was strengthened after one independent review found the cross-project snapshot loss and was red then green again. Real pool tests and changed source/exclusion tests passed seeds 1/2/3; the native composition file's final seed 2 passed all 18 test bodies but failed teardown on a surviving SQLite child, escalated to its existing infrastructure owner. The server typecheck reports unrelated DOM globals in column.e2e.ts; the MCP package typecheck passed.