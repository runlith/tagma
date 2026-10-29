---
id: 01a17e02-c2c3-7e72-85ef-84b99d773f08
title: Low yields CPU via nice, without pinning to efficiency cores
ord: 7
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a17d59-ec17-7df5-b790-3823cfc750ae
---
Replace the low utility QoS with lowered nice, keeping the full ↔ low ↔ lowest transitions for the leader and children. Prove through the host's public contract with a test red before the fix and a load measurement from the itest; verify Linux and reconcile the tempo explanations.
