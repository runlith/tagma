---
id: 01a11d60-1f4c-7099-8da1-3565cd6ca30f
title: Implement the single module-change contract and atomic write
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a11d5c-f6ad-71c1-89fb-c64e401d202c
---
Implement the agreed spec: one-time link resolution, put/drop/replace of collections, aggregate refusals, freshness checks inside Act.unit and a compact public projection. Start from the enforcement and graph contracts, carry all current consumers together. Owner tests of public operations, landing checks and the commit confirm completion; name anything unverified explicitly.

Revision of October 10, 2026: implementation and fixes are in main — f3f02a90d4, fd52c03a11, 16b3d9d784. Current owner tests `composition/testing/enforcement/modules.itest.ts` (13) and the serialized door `composition/testing/http/modulesDoor.itest.ts` (1) passed; server typecheck clean. Resolved writer links, shared `Act.unit`, deltas, aggregate refusal and compact answer verified. The full inspection suite wasn't rerun; usability on a live card wasn't checked by the operator in this revision.
