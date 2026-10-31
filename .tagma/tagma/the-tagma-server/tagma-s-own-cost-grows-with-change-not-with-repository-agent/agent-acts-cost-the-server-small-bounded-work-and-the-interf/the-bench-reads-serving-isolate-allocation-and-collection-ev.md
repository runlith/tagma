---
id: 01a18f4f-b747-7f98-835d-a2108fed156f
title: The bench reads serving-isolate allocation and collection evidence without conflating other VMs
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18f18-0d87-7ab2-a275-054ae8b576bf",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a18cde-5f93-73e8-aa31-64572afe6fec
---
Establish what the executing Bun/JSC exposes per isolate for JS allocation and collection pauses, then implement the cheapest exact reading those capabilities support. Where exact per-isolate pauses or allocated bytes are unavailable, retain primary-source and runtime evidence and expose only a bounded alternative whose meaning is explicit. Preserve product behaviour and keep measurement overhead bounded; provide the bench with the reading contract and its limits.