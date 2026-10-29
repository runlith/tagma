---
id: 01a16527-352c-7185-bffb-404f67e77668
title: "Closing the last task names the spec left with no work, and the #spec text says who closes it"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16527-9b8b-70a1-bbe6-c99343d6972e",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16527-352c-7185-bffb-404d3490910c
---
`endResult` (`graph/operations/answers.ts`) adds `specs: [{name, title}]` on the debt pattern: open specs up the tree or over `implements` with no active tasks left. The line: "spec S has no open work left — close_block S if built, or name the remainder in it". The delivered `#spec` text (`catalogs/contract/wire/softwareDevelopment.ts`): whoever closed its last task or led the work closes the spec. Test: a spec with two tasks — closing the first does not name the spec, closing the second does.
