---
id: 01a13ffe-028b-787b-b7c0-d74c12827d87
title: Migrate the ThreadIntrospection ceiling tests to Effect
ord: 23
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d30-d804-7b33-9b8b-12527b27377d
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadIntrospectionCeiling.test.ts
---
Migrate ThreadIntrospectionCeiling.test.ts to it.effect with no direct runner and no casts of query/targets/ports. Full dependencies under their own tags, unused operations fail-fast. Merge the repeated aggregate walk with the source cursor check; keep aggregate/ranking/read-ceiling and complete population. Change no production. Serial file test, package check, law, one Sol+Muse round, evidence to the parent before landing.
