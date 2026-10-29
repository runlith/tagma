---
id: 01a17a50-d68c-7585-86b0-7c18507720ec
title: "Server door tests resolve on fact, not on timeout: HTTP, CLI, remote, plugins, and other composition tests outside graph and threads"
ord: 45
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17a51-b582-77f4-966a-a304b03c72b9",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
---
Area: `apps/tagma/server/src/composition/testing/` except `graph`, `enforcement`, `landing`, `change-record`, `worktrees`, `workspace`, `threads`, `native-harness`, `external-harnesses`, `executions`, plus server modules outside these and outside the neighbor tasks' areas. An explicit test timeout and `Effect.timeout` waits are replaced with waiting on the fact; a timeout that verifies the product's own behavior stays. A file that fails in a parallel shuffled run and passes alone is fixed at the root — shared state, order, an event never waited for. Acceptance: the area's files green on three seeds in parallel with `--no-isolate`, no timeouts outside the product's subject.
