---
id: 01a0d55b-28b6-7fd3-be7b-88854fc455ef
title: Enforce runlith's server floors as a gated rule and delete `boundary.direction.ts`
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d686-34ce-7586-abd9-e5b6a00be0f6",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d4db-9d8b-7af7-9481-2eb115d47c9d
  - kind: waits-on
    to: 01a0d55b-28ab-7278-bd11-958ec63391c1
  - kind: waits-on
    to: 01a0d55b-28af-7845-a303-938d0c9b09b0
---
Per [[15d47c9d]] Enforcing and Docs: the `#rule` under the Tagma server, one `enforce_rule` at gate at landing with the `direction` parameters, the three `install/` entries owned by [[d0e09e2a]]; in the same change delete `boundary.direction.ts` and the direction assertion of `boundary.test.ts`; rewrite [[1023b406]] and [[8779de7a]], supersede [[92a549da]]. Done when the acceptance of [[15d47c9d]] and of [[be584b76]] §7 holds.