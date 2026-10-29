---
id: 01a15261-5fba-7a37-a839-fa66c2a15b7e
title: Native adapters register rules as contributions, and composeAgent reads the shared registry
ord: 26
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/composeAgent.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/contract/service/rules.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/native-harness.ts
  - kind: file
    ref: packages/agent/src/agent/policy/AgentRuntimePolicy.ts
---
Each native-harness part declares a source next to its rule implementation and contributes it through its module manifest. Composition gathers the sources into an `AgentRuleRegistry`; the factory receives the declaration's full dependencies, and its rules are cached on that declaration until registrations change. Priority sets the order, so module order does not change the guidance sequence; capability and overlay runtime checks stay with the rules and their owners.
