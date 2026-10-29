---
id: 01a0f4aa-02df-7d16-9b0b-54e5fe92fe63
title: "Tag step 2: core/* behaviour contracts at their owners, roles translated one at a time; LawProjection and the predicate's owner test swap to contracts"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f507-9cbb-7195-8466-47d71bcf0937",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f483-46b4-7a20-8471-e0b5877ba8f0
  - kind: waits-on
    to: 01a0f4aa-02d4-7a19-baaf-bdbcbbf9ebd0
  - kind: waits-on
    to: 01a0f4aa-02db-794f-b21a-598eee489b18
  - kind: waits-on
    to: 01a0f4ab-e2ea-7966-bbfe-510a2947c38b
  - kind: waits-on
    to: 01a0f506-7376-7fe6-ad77-231f974b0baf
---
Builds [[877ba8f0]]. Descriptor registration and compatibility proceed independently in [[974b0baf]]; full role migration consumes the compiler and stable identity. Concrete boundaries and law-team integration: [[0f83e781]]. Class: **complex** (claude-opus-5-5 `high`). Each role is translated with a check that its former answers hold. The law contract is registered by enforcement over its union-free codec; `TagTable.lawProjection` and the owner test of enforcement's predicate module change implementation only. Acceptance: [[877ba8f0]]'s.