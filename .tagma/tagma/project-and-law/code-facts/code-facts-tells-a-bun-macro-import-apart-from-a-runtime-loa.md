---
id: 01a1616b-3aa2-7f94-83cc-f88d05517689
title: Code-facts tells a Bun macro import apart from a runtime load
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1616b-6b22-795f-a1bf-20d56ddda44f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16152-c605-7a6c-848d-1fb17bd07b34
  - kind: discovered-from
    to: 01a1616b-1dba-7a06-8b59-34f4b4e7efac
---
`import … with { type: 'macro' }` runs at build, but the code-facts JS adapter marks it `with-module`, and runtime checks walk into macro code as process code. Fix at the import-sites producer: the dependency stays visible to module checks, runtime load stays absent; check the public contract and both parser paths of the adapter.
