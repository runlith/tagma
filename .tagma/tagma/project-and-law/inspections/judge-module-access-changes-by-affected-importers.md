---
id: 01a12d0b-36c5-749e-b5a9-4aaa3a13480f
title: Judge module-access changes by affected importers
ord: 22
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12d0a-ffc4-7bf9-8268-fb377cee8a0f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12ce8-c230-7c84-b73e-af878166f224
---
Fix the `modules` builtin at the owner: widening entries and relations does not re-read consumers, narrowing access checks affected importers through the existing index. Remove the fixed file-count limit as a refusal ground; contract tests must prove widening locality and the violation after narrowing. Completion: profile tests, `bun run typecheck` within three minutes and three processes, an independent Sol xhigh review and one Muse lens, a landed fix. The operator updates the operator's server.
