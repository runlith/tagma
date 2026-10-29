---
id: 01a118df-7dd7-7b8b-af1c-240c49b24903
title: "Step compaction on Claude over ACP: at step in _tagma/compact, Claude Code auto-compaction by flag, PreCompact hook instructions, mid-turn Tagma threshold"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a113b6-e688-7d52-aa41-ac2f488d9c79",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118db-5778-76bc-8936-4436a9943509
---
Build [[a9943509|step compaction]]: the runner (query environment and settings, `at` in `_tagma/compact`, `PreCompact` and `PostCompact` hooks, the “no step happened” refusal), the driver (the request with its `at`, serving `step` mid-prompt, the steer barrier, the mid-turn threshold), the tests from the “What proves it” section, notes [[92391518]] and [[d0810682]], the `compact_thread` `grammar`. Start at `runner/claude/compaction.ts` and `protocol/compaction.ts`. Done when the runner contract tests, driver system tests and live smoke pass, and the overflow probe has picked a branch.
