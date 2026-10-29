---
id: 01a1758b-f833-7c59-8305-b80296d1f0e3
title: Findings caused by the check change itself are attributed to that change, not searched in history
ord: 33
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17583-763b-74fd-84bb-4aa8f4659071",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17561-43b1-71f4-9811-b8570ba1933d
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-63387548cc1d
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/remeasure/origin.ts
---
When the measurement identity diverged off-tree — the inspection implementation changed (a Tagma update), the reach, the module map, or the rule's debt — `escapeOrigins` re-reads the boundary (the last confirmed measurement). A finding standing on the boundary under the new check already sends the lookup through all of history (`full: beyond.size > 0`): old versions are measured with today's code, and a version it cannot judge fails the remeasure.

A description edit in `tagma.config.ts` attributes its findings to the editing commit. A check change outside the repository must behave the same: a finding standing on the boundary under the changed check is an escape of that change, recorded honestly (the boundary plus a mark that the check change, not a commit, let it through), with no history walk.

Done when the test through `ruleRemeasured` → `remeasureRule` with a changed inspection implementation is red before the fix and green after.
