---
id: 01a160ac-c534-74c3-b644-7d61faa9edd6
title: "A noise-free enforced rule page: one place per fact, settings collapsed"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a160a9-eff1-7eb7-8981-297bf6af99a5",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/rules/Debt.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/rules/Engine.svelte
---
Operator: the rule page is "noisy, as if lots was done". Every fact is repeated: debt growth — by a "Known violations grew…" line and an arrow with a chart; a recent refusal — by a line above the page and a line in "Commits blocked"; delivery — by a Delivery line and a phrase in "What it checks"; the debt-owner task — also in "Referenced by". Empty sections talk about themselves ("Nothing slipped through"…), while "How to fix", "What it checks", and "Details" stand on par with violations.

Do: one place per fact; the debt trend — in the "Known violations" header; the rule's shared hint — in an expanded violation line without its own; emptiness — one "no violations" line; what the rule checks and details — one collapsed line with the essence; a block child visible in the outline isn't repeated in "Referenced by".
