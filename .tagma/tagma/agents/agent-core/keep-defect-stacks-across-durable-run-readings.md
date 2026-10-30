---
id: 01a18a45-81e4-74c8-aecd-a71b1748f54a
title: Keep defect stacks across durable run readings
ord: 205
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18a3c-15ea-7e36-afbb-1303ae05a951",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a15546-c8d5-7af0-8cac-ef9af07eeb40
---
Use the transcript-owned failure diagnostics schema for stored runs and their public wire. The second schema in persisted.ts drops stack while read_thread reads run rows, although the failure entry keeps it. Prove a persisted TypeError stack survives read_thread and the run wire, then remove the duplicated schema.