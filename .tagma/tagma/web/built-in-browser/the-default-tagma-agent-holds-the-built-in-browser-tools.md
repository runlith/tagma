---
id: 01a18447-5a5c-755d-a1dc-42d84d9baba3
title: The default Tagma agent holds the built-in browser tools
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18433-d315-73f4-812d-a71e5c06e846",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a147b0-e165-75df-b2b0-9a0cf3ea399e
  - kind: relates
    to: 01a14c37-8e6a-7661-a5b2-594749d0c505
---
The operator decided (2026-10-28) that every `tagma` agent gets the `browser` capability, closing idea 49d0c505. The browser module declares `joins: ['tagma']` like navigation does, so the tools arrive deferred with no edit to the agent's own list, and a prompt line under the typed tools says when to take the built-in browser and how a picked element's reference is used. Agents extending `tagma` keep it unless they narrow their capabilities. The six browser features standing at partial for this reason become live, and the showcase skill and installed OPERATIONS.md (f2491ef5) follow.