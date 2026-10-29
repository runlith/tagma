---
id: 01a156ea-c610-782c-8954-90b46197d83b
title: A two-project system test proves place from subject for every kind
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1565c-47b9-7ff2-bfd3-246b13adade8",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15666-29d3-7512-8c0c-71e28fa6e159
  - kind: waits-on
    to: 01a156ea-c610-782c-8954-90b16bb9bbf2
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/subjectPlace.stest.ts
---
Acceptance scenarios of the spec: a block (`check_law` with an `inspection` over rule B, `read_block_log`), a path (`read_owners`, `check_law` staged), a checkout/worktree (`check_worktree_merge`, `clean_up_worktrees`), a thread (`read_thread`), the law of the place (`law-unread` without a `project` field), contradictions (`place-mismatch`), cwd versus an explicit project, `set_module`, a `update_block` move, `check_law` over change with lines in worktree B.

Proof: a green `*.stest.ts` file within its budget.
