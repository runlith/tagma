---
id: 01a0d55b-28ab-7278-bd11-958ec63391c1
title: "Re-measure enforced rules after landing: retire vanished debt, record escapes, raise `rule-escaped`"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d64f-af45-78f6-bbc7-1150b9696314",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d4db-9d7d-7a78-ab39-a9d0f2755a5b
  - kind: waits-on
    to: 01a0d55b-28a8-7228-a4fc-3a48c78cd6c5
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/remeasure/driver.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/remeasure/rule.ts
---
The driver of [[f2755a5b]], wired in the same change as its promise ([[a00f91b0]]): after each landing and merge through Tagma and at server start, debounced per rule, on the whole-reach worker, off every permit; one journaled act per rule; a doctor check reading `escaped` off the document. Done when the driver acceptance items hold.