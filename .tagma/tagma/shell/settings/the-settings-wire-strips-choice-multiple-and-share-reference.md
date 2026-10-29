---
id: 01a0cae4-9460-7e0f-81b4-8bd001d91743
title: The settings wire strips choice `multiple` and share `reference` the surface reads
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f2e-523d-71cd-acb6-4296368176de",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/settings/contract/wire/catalog.ts
---
The wire's `controlSchema` re-declares choice without `multiple` and share without `reference`, so both fields are stripped on encode — while the surface reads both from the served entry. Reported consequences: the `graph.catalogs` key renders single-choice instead of the choice set, and `agent.toolOutputShare`'s ceiling sentence never renders. The api test pins encodability (`not.toThrow`), not field survival, which is why the strip went unnoticed.

Done when the wire carries what the surface reads — `multiple` and `reference` restored on the wire members — with a test pinning the fields' survival, not just the encode.