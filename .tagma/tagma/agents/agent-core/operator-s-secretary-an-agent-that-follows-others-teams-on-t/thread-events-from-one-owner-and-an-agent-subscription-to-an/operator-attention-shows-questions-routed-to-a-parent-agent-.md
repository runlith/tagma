---
id: 01a164ef-091c-77ef-bb7c-9ff888b55e10
title: Operator Attention shows questions routed to a parent agent as awaiting the operator
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a164ef-27a7-776d-9e6b-92076e26b62c",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14bc0-7696-71f4-8eeb-ff1e8a780ecb
  - kind: relates
    to: 01a16425-1e63-70b5-afdd-28ffe46b150a
---
The operator's "Attention" shows as awaiting the operator only questions whose route gave them to the operator, including ones routed to a parent agent.

2026-10-22 check: worker-1 (`01a164ee-31c7-7f9c-ab88-144dcc8f2f79`) asked `ask_user`; the route correctly gave the question to its lead (`approver: 01a164ed-f909-7f4e-9d15-5bef4aad5683`) and the lead answered. But while the question stood, `read_attention` still served it to the operator as a `kind: awaiting` row. The app does not read the `approver` field (`apps/tagma/app/src/lib/app/attention`); so the question reached the operator's bell. Operator decision: workers are hands the operator need not know; awaiting the operator is only a question whose approver is the operator. The `awaiting` subscription event and push already count this way; "Attention" (`standingOf` in `threads/events/standing.ts`) did not.
