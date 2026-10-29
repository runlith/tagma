---
id: 01a18458-1bc4-7369-ae0c-c675c7432228
title: A tools whitelist trims capability guidance only when the declared inventory proves no tool survives
ord: 59
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a11926-4535-762c-a8e7-af3319daf275
  - kind: relates
    to: 01a16bd1-914a-72f4-9e3a-60d9a3d78531
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/effectiveAgent.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/availability.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/cueRule.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/inventory.ts
---
A tools list narrows calls, not the capability grant or its law audience and rules. Prompt sections, cue hints and availability guidance omit a capability only when its complete declared inventory has no tool admitted by the catalog resolver, including standing exemptions. Runtime and live sources with an incomplete inventory keep their guidance because a preview starts no connection and unknown is not empty; preview and thread birth share this projection.