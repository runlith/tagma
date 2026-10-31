---
id: 01a18f4f-b747-7f98-835d-a2108fed156f
title: Establish the Bun allocation and collection measurements the bench can claim
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18f18-0d87-7ab2-a275-054ae8b576bf",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a18cde-5f93-73e8-aa31-64572afe6fec
---
Establish which allocation and collection measurements the executing Bun/JSC permits the bench to claim, without adding intrusive or unbounded always-on collectors. Evidence in [[13b4bae4]] distinguishes cumulative process allocator-request traffic from serving-VM JS allocation, collection-cycle elapsed time from mutator suspension, and heap gauges from cumulative allocation. The accepted bench gate uses allocator-requested bytes per act only across matching process compositions; collection timing is diagnostic, while loop-delay and stall gates remain the bounded responsiveness measures. The performance skill carries these interpretation limits. Exact serving-VM cumulative JS bytes and pause p99 are not supplied by the checked Bun APIs; no proxy is presented as either.