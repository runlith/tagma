---
id: 01a0ca95-3100-725a-a63f-53ab9b89a2c1
title: Write the claims of the journal and the block page
ord: 185
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
---
Two areas grouped because the block page embeds the journal: [[0280f4e2]] and [[ebc1d3d8]].

Read `apps/tagma/app/src/lib/features/graph/journal` and `apps/tagma/app/src/lib/features/graph/block` whole. `BlockPage.svelte` is 931 lines — the largest component in the module — and `ProposalsSection.svelte` is where the amendment workflow reaches the reader. Load the `svelte5` skill first.

The block page is the one place the folder order lets a graph surface read siblings, and it reads exactly two — the outline and the journal. That permission is declared in `src/lib/layout.test.ts`; state what the page does with it rather than restating the rule, which [[e3e9376a]] already carries.

The module above is [[cc59eadf]]. The reference zone is [[cb732496]].

Done when: the claims are written from the code and verified, the doctor over both paths is clean, and a review passes.