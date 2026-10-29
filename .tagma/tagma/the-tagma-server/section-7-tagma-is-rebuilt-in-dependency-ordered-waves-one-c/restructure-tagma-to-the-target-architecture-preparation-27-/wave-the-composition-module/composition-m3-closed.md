---
id: 01a0e532-cf42-72b8-aaf0-37f9ba1954f8
title: "composition M3: closed"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e816-300f-732c-a1c2-61a63ba56cdd",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-cf39-790b-91f0-e6587139e341
---
§7.2.2 milestone `M3` of the `composition` card ([[f7e0b9dd]]), with its vocabulary amendment [[aa1b0681]].

Finished with divergences: K5b (per-module contract snapshots and the `contract-snapshot` rule) is not built — no rule of that name exists in the graph. K6's parity holds through `composition/testing/http/{doorParity,commandParity}.itest.ts` only. The central lists that still parallel the manifests (`catalog.ts`, `operationMap.ts`, `operationCatalog.ts`, `rpc.ts` LiveRpc, `socketBinding.ts`, the completeness lists in `ports.ts`/`start.ts`) and the domain logic in `graphSync.ts`, `snapshots.ts`, `preparedChanges.ts`, `operationChecks.ts` are composition N's to remove ([[c3975054]]).