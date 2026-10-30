---
id: 01a18e93-26aa-79d2-835e-f9f294d49d29
title: Offer program models only when their declared window can serve asks
ord: 29
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18e90-ac8f-7e3f-b6e5-5faf5fe88765",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a18cbf-9775-75eb-a4a1-6542bcec10b7
---
Make the served ask kinds agree with program admission: a program model without a usable declared context window must not enter an ask picker, and direct requests must refuse through the same route contract.