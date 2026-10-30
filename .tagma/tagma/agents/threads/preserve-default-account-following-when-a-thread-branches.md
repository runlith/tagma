---
id: 01a18dbc-29e3-792e-91b3-fc746d3c7e07
title: Preserve default-account following when a thread branches
ord: 142
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18d97-bae9-742d-b250-62fe61583ec4",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a16efb-4661-717d-8fa5-b19d3257c9e8
---
Keep a thread's account choice separate from the account holding its vendor session: branches inherit default-following or an explicit account, launches and continuations respect that choice, and default moves continue only eligible work. Make the two modes legible in the existing model picker, repair historical pins only where their automatic origin can be proved, and cover branching, limit recovery, explicit pins and operator stops through the product doors. Historical inspection found no safe automatic repair cohort: the stored account has no choice provenance, and a person's later selection of the same value is indistinguishable from the birth pin, so existing choices remain unchanged.