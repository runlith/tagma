---
id: 01a16034-a38c-7e46-90db-ee30858278ae
title: Speed up fixture and handover in protocolRuns without weakening contracts
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16034-46ce-75b0-868b-492a201d719a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16023-4386-715f-8a0a-768e6b901a48
  - kind: implements
    to: 01a15eeb-6b48-7ca8-9c93-24da026af37c
---
In protocolRuns.stest.ts the fixture completes WAIT on a file event after proven adoption; three already verified ACP sessions release before the next cases and two repeated boots. One separate bun test before/after: 39.65→34.70 s, 8 pass, 49 assertions; recovery 5.399→1.663 s, handover 9.919→3.831 s. This is one sample on a shared machine, under changing load and a parallel server typecheck: the clean size of the speedup is not established. The server typecheck passed.
