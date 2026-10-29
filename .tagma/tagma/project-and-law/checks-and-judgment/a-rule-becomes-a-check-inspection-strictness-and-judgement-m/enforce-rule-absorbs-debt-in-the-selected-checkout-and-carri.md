---
id: 01a1616e-323f-76e4-8e92-db96e2283964
title: enforce_rule absorbs debt in the selected checkout and carries it with merge
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1616d-7274-751a-9e54-77c876e4ba84",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1616d-48d3-777b-ba17-23d3d6d91cfd
---
Give enforce_rule the same checkout choice as submit_work and check_rules, so the offered gate exit absorbs the violation in the failing tree and records its debt in the matching graph copy. The refusal names the checkout; the public test verifies absorb of another project's uncommitted edit, the landing, and a merge with debt. Update the contract and the rules skill, verify the typecheck, and run an independent review.
