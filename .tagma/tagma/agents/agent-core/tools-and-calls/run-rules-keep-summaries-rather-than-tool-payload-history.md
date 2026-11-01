---
id: 01a1947b-2805-7232-84fe-70dc7e09122b
title: Run rules keep summaries rather than tool payload history
ord: 22
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentRunState.ts
---
Run-wide tool counts and the last streak are summaries over admitted calls, restored from prior records when the run is assembled. Deduplication identities last through the native step commit or a hosted call's confirmed outcome; their resident population follows unfinished work rather than run length. Rules needing a fact from an outcome reduce it from `afterTool` into their own `ruleState`; the run state is not a second transcript or an output store.