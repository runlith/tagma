---
id: 01a11901-5360-733e-9ca2-911fc86fbefa
title: "A run catalog from one resolveCatalog function over a source registry: only definition grants, verdict denies"
ord: 17
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118eb-3e7e-7085-8f2e-2ccc8451c5c9
  - kind: waits-on
    to: 01a11901-5360-733e-9ca2-911ed3c0852f
---
Implements [[8451c5c9]]. Start with `AgentProfile.ts`, `admittedToolSources.ts`, `AgentScope.ts`, `ThreadRunStarter.ts:500-521`, the Tagma `native-harness/agents/composeAgent.ts`, `permissions/vocabulary.ts`. Done per the spec criteria: a `{look, act}` run test on every road, unchanged built-in agent name sets, `deny`.
