---
id: 01a0ca95-30eb-7230-8f8b-a0dc581c7394
title: Write the claims of the components that belong to no feature
ord: 179
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0ca9a-7981-7fed-8c13-fe426aba4e31",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
---
The area is [[d538063b]]; read `apps/tagma/app/src/lib/shared` whole, including every `ui/` family. Load the `svelte5` skill first.

The shadcn-svelte families are vendored source this product owns and may edit, not a dependency — say what this product changed about them where it did, and do not write a claim that merely restates what the upstream component is. `terminalThemes.ts` is the largest file here and stands in this folder rather than in the terminals because two folders read it; that placement is the folder order's doing and is worth one claim.

The module above is [[cc59eadf]]; its ink claim [[2106198b]] already covers the token contract these components resolve against. The reference zone is [[cb732496]].

Done when: the claims are written from the code and verified, the doctor over `apps/tagma/app/src/lib/shared` is clean, and a review passes.