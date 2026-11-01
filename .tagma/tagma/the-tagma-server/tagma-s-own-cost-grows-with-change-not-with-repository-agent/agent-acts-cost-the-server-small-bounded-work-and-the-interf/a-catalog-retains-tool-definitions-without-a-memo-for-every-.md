---
id: 01a19481-040b-7ef7-b194-f5ce7dff0a0d
title: A catalog retains tool definitions without a memo for every active selection
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19472-941a-74d3-8eef-408e0480f0ac",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a19471-c11f-7184-8092-d9bf92fd4cda
  - kind: implements
    to: 01a18cde-5f93-73e8-aa31-64572afe6fec
sources:
  - kind: file
    ref: packages/agent/src/agent/ModelRequests.ts
---
`wireToolDefinitions` in `ModelRequests.ts` creates fresh `ToolDefinition` objects for each active-tool selection and stores every array in `wireFootprints.narrowed` until its catalog is collected. Keep the definitions owned by the catalog and only the selection state the current request needs, without a growing per-selection memo. In the two-agent hosted-call census, all four warm/loaded cuts contained 564 definitions; that static-catalog workload does not reproduce or attribute the live growth from 6,832 to 9,377. Prove the fix by a full-collection owner census across many selections of one live catalog, keeping request schemas and selection behavior intact; name the part of the live growth that remains unproven.