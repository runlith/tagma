---
id: 01a12c96-38c6-73ae-a745-5ecf77e29940
title: Verify the bytes subscription ending on explicit record retirement
ord: 3
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a12c87-3ce1-77a1-b29c-cb5e536ffde9
sources:
  - kind: file
    ref: packages/execution-host/src/subscriptions.ts
  - kind: file
    ref: packages/executions/src/WireReaders.ts
---
Review surfaced the subscriptions.endingOf chain: ExecutionUnknown/ExecutionRefused map to completed, which the spawner takes as EOF. Through public retire/disown and subscribe, establish whether a record can vanish before all available bytes are delivered, and on that outcome return an honest unavailable instead of success; normal ending and the move to the sealed shelf must stay completed.
