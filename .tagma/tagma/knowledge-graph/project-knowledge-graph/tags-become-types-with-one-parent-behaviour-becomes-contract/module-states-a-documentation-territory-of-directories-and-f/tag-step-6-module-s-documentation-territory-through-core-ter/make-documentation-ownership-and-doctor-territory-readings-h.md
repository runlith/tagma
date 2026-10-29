---
id: 01a0f508-d3bb-7e1a-aea9-50581643dd7a
title: Make documentation ownership and doctor territory readings honour directory and exact-file territories
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f50a-0378-7d22-856c-90e0f9072154",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f483-46d9-7300-827a-c99114e01b12
---
Independently implement directory/file documentation territory reading for [[14e01b12]], under [[166998c2]], following [[0f83e781]]. Class: medium, Sonnet high. Owns `graph/sources/ownership.ts` and the doctor's territory selection/findings; starts by reading their real contracts and claims. It does not own law unit enumeration, the compiler, catalog installation or a new hard-coded module-kind switch.

The library owner holds `catalogs/contract/wire/codeProject.ts`; ask it for the precise module-source change (dir+file and a source-required condition accepting either), rather than making a second broad catalog edit. The contracts owner supplies `core/territory` descriptor registration, and compiler supplies inheritance. The lower-level file/dir ownership algorithm and its public source-query tests can land independently; the parent remains open until contract-backed module descendants are covered. Do not introduce a temporary role or fake capability to stand in for the final contract.

Acceptance: exact file territories and directory prefixes produce correct narrow ownership and doctor coverage, including overlap and cross-module evidence without falsely moving the claim's semantic owner. Changing documentation ownership never creates architecture-law units; if a change actually changes an adopted rule's reach it remains subject to the law's existing guard. Tests prove output/ownership and findings, not selected helper calls. Do not alter enforcement or the graph's active catalog as a test fixture.
