---
id: 01a17b31-1c07-7a93-afb1-badfa98fbd02
title: Graph publication passes one git layout from operation check to CAS and index
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17b0f-3179-7b33-b757-80acce88f8f3",
    "status": "done"
  }
---
Drop the repeated GitPlaces read in one publishToCheckout: the first read at the unfinished-operation check passes into platform.publish, advance, and settleIndex. HEAD, branch, operation, and CAS stay fresh at the earlier points; the layout never outlives a publication attempt. Measure git/CPU by producer, verify the touched contracts separately on seeds 1/2/3 plus typecheck, run one independent review.
