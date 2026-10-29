---
id: 01a1089e-978d-7423-bc88-3a1de25a0bbf
title: ACP driver in external-harnesses, transport in facet, hooks roles, turn-writing port in threads, and the Devin profile
ord: 3
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a10838-8f2b-7e30-a2b0-7563adb9cd5b
  - kind: waits-on
    to: 01a1089e-978c-7d5c-882b-9d4ec09e81c7
  - kind: waits-on
    to: 01a1089e-978d-7423-bc88-3a1c07a91ddd
---
Decisions 3–9 of spec [[adb9cd5b]]. Start by checking input into held pipes execution through the lane harness. Done: the `harness:devin` thread on `acp` passes checks 1–6 and 9 of the spec.
