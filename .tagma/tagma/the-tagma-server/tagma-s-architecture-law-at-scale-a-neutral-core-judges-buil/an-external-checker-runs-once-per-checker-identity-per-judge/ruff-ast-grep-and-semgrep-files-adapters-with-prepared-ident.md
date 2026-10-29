---
id: 01a0f747-396b-78a5-9b1a-52dd1da1a2a4
title: Ruff, ast-grep and semgrep files adapters with prepared identities and conformance
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f746-df65-772b-989c-41fded6bfc60",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f476-04de-7739-9ff5-ba99d11108eb
sources:
  - kind: file
    ref: apps/tagma/inspection/src/runners/ast-grep/adapter.ts
  - kind: file
    ref: apps/tagma/inspection/src/runners/ast-grep/directives.ts
  - kind: file
    ref: apps/tagma/inspection/src/runners/files/counts.ts
  - kind: file
    ref: apps/tagma/inspection/src/runners/ruff/adapter.ts
  - kind: file
    ref: apps/tagma/inspection/src/runners/sarif/reading.ts
  - kind: file
    ref: apps/tagma/inspection/src/runners/semgrep/adapter.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/checkers/identity.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/checkers/prepared.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/adapters.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/ast-grep.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/filesRunner.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/ruff.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/semgrep.ts
  - kind: file
    ref: apps/tagma/server/src/executions/commands/programRoad.ts
---
Implement the next-phase Ruff, ast-grep and Semgrep adapters in inspection runners and enforcement programs, extending prepared checker environments for pinned non-npm artifacts where needed. Acceptance: one process over both sides; strict config, complete decoding and supported-file refusal; governed suppressions cannot hide findings; locator-free checks require count budgets; offline real-tool conformance or explicitly prerequisite-bound system conformance plus pure contract tests; source-bound claims and independent review.