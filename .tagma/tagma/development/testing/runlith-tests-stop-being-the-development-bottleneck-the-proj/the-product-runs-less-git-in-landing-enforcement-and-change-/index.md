---
id: 01a17ad9-53ab-70cb-9a5f-ee5de872922e
title: "The product runs less git in landing, enforcement, and change-record: cuts at producers by call site"
ord: 53
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17ad9-64cb-7877-b99c-2baf36b8a082",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
  - kind: relates
    to: 01a16c8d-16cd-71b0-bf80-15dfafa44677
---
Step 3 on the reference measurement [[ac47dc8a]]: git costs 501 s CPU and 50,884 processes in the server's integration, most in landing and enforcement. Continues the [[afa44677]] inventory: attribution by call site, repeat cuts, and read merging at the producer, before-and-after by sites and CPU.
