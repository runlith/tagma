---
id: 01a0f747-21eb-7c5c-b10e-56569b04a2f4
title: The ESLint files runner with Svelte and conformance
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f746-df0d-7faf-8f28-144dc8952105",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f476-04de-7739-9ff5-ba99d11108eb
sources:
  - kind: dir
    ref: apps/tagma/inspection/src/runners/eslint
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/eslint.ts
---
Implement the ESLint files adapter and server execution road under apps/tagma/inspection/src/runners/eslint and apps/tagma/server/src/enforcement, following [[d11108eb]] and [[c09fe8dc]]. Acceptance: one grouped process for both sides, strict config and output validation, unsuppressed Svelte script readings with preserved positions, prepared checker identity and plugin equivalence proof, offline real-ESLint conformance, source-bound claims and independent review.