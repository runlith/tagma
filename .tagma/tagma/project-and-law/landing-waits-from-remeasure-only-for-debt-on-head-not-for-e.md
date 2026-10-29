---
id: 01a1758b-f869-7120-86f5-c8b7a7954904
title: Landing waits from remeasure only for debt on HEAD, not for escape-provenance search
ord: 34
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
    ref: apps/tagma/server/src/enforcement/remeasure/driver.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/remeasure/rule.ts
---
`Remeasure.ready` waits for the whole opening remeasure, including `escapeOrigins`. A provenance-search failure after three attempts refuses `inspection-failed` to every `submit_work`, `merge_worktree`, and `check_rules` over a change in that checkout, while a successful but slow search delays them.

Landing needs only the removed debt from the remeasure: debt whose violation is gone on HEAD must not justify a new crossing with the same fingerprint. The landing court never reads escapes. So the remeasure first records debt and standing escapes, and `ready` opens on that; the provenance search for new escapes runs after, in the same driver pass, and its failure reports and repeats as a remeasure failure without stopping commits.

Done when `submit_work` in a checkout where provenance search cannot pass lands, and the removed debt records; the test turns red before the fix.
