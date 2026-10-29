---
id: 01a10c35-e260-7060-ac56-d031f3f9a06d
title: Remove measurement observations from the rule document, reconcile debt lowering on merge, and name an open graph merge
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10c36-1137-792d-a9b6-aa527cf4136c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a10c35-d246-7a89-b8b9-b324b58a937f
---
Do the whole [[b58a937f]]: the spec's three parts and its acceptance. Start from `graph/contract/wire/enforcement.ts`, `enforcement/rules/enforce.ts`, `enforcement/remeasure/rule.ts`, `graph/tree/layout.ts`. Done when acceptance passes by tests and typecheck is clean.
