---
id: 01a0de5c-f058-78da-a8cc-761e116f61ac
title: "answer_reflection cannot be withdrawn: a wrongly named answer leaves the reflection answered with no operation to undo it"
ord: 3
tags: ["reflection"]
fields:
  {
    "actual": "unlink_blocks refused no-edge both ways: the answer is an `answer` event, not an edge, and no operation removes it. The mark could only be displaced by filing a later block as discovered-from the reflection, which the answeredBy reading prefers over the event.",
    "command": "answer_reflection with blockId 84694b75 and by e5667424, then unlink_blocks tried both directions of an answers edge to take it back",
    "expected": "An answer named in error can be withdrawn, the way unverify_block withdraws a wrong stamp and unsupersede_block a wrong replacement."
  }
---
Filed from project `runlith`.

Measured cost: the wrong answer stood in the graph for about forty minutes, and the reflection had already left the standing queue, so a reader between the two writes saw it closed by work that does not answer it.

The road that displaced it — a new claim created with `discoveredFromId` — is not stated anywhere a caller reads; it was found in the SQL of `answeredBy` (apps/tagma/server/src/graph/core/Act.ts), which is the reading a caller should never need.