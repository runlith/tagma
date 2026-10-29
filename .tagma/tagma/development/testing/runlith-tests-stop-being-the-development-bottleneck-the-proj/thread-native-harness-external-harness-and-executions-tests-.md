---
id: 01a17a50-d68c-7585-86b0-7c1a782481cd
title: Thread, native-harness, external-harness, and executions tests resolve on fact, not on timeout
ord: 47
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17a51-b5a7-79be-8b65-bfd8929ad077",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
---
Area: `apps/tagma/server/src/{threads,native-harness,external-harnesses,executions,thread-record,managed-browser}` and `composition/testing/{threads,native-harness,external-harnesses,executions}`. An explicit test timeout and `Effect.timeout` waits are replaced with waiting on the fact; a timeout that verifies the product's own behavior stays. A file that fails in a parallel shuffled run and passes alone is fixed at the root — shared state, order, an event never waited for. Acceptance: the area's files green on three seeds in parallel with `--no-isolate`, no timeouts outside the product's subject.
