---
id: 01a19be2-6852-72a5-9390-f1990459d79c
title: Preserve local edge addresses through fresh-mirror projection and adoption
ord: 23
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19bd4-fa5b-76cd-b21e-acafe2dcb40d",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a13177-f9f5-71bb-a671-b074491f9937
  - kind: relates
    to: 01a1369b-24c0-7f0a-ac26-731c9cd335df
---
A fresh mirror has no saved trash, so a format adoption can erase a holder's edge to a deleted block and a later merge can remove that edge from a target which still supports restoring it. Reproduce ordinary block deletion and branch adoption through the graph operation door; preserve unresolved local addresses at the file-mirror boundary, without reviving missing blocks or exposing missing targets as live knowledge, and prove restoration retains its incoming relation.