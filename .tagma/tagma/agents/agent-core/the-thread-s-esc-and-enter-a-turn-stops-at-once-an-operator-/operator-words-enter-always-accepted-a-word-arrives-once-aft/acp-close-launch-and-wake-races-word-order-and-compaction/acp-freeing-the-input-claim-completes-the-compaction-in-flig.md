---
id: 01a16042-08aa-7ffe-816b-8a21a7a9ec72
title: "ACP: freeing the input claim completes the compaction in-flight request"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16023-ba88-7954-9f0f-f8f65415922c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15eeb-6b48-7ca8-9c93-24da026af37c
---
Fix the review finding: after UNSTEPPED with an open prompt, the compaction request leaves the claim on the turn end but stays in WordsInFlight and, together with a late steer, holds the follow-up. Releasing returns the really removed ids and passes their fate along with the same turn-end record; the system test confirms the next prompt.
