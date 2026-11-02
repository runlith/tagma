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
A fresh mirror has no saved trash, so format adoption could erase a holder's edge and a clean merge could make restoration lose that incoming relation. The working-tree fix preserves unresolved local addresses without placeholder blocks, binds arriving targets, and includes these addresses in retagging, explicit unlinking, relocation, and successor retirement. The HTTP regression with ordinary untagged notes failed before the fix with an empty outgoing-edge set after restore and now passes. Final checks: server typecheck, 39 targeted tests in seven files, both changed test files separately on seeds 1/2/3, and 24 enforced rules with no findings; the earlier eight-file projection/adoption run passed 41 tests. One independent review's confirmed findings were corrected in the same round. Ready but uncommitted on the operator's instruction.