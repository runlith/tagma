---
id: 01a0db81-ee37-777c-87b6-4dd01098baef
title: Remove every re-export from the runlith workspace outside `@tagma/inspection` and `@runlith/code-facts`, and respell `loads` rule 0d2c66a9 for the new exports maps
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0db82-4df0-7dc6-82a5-f9708a4c28a9",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0db81-b8b3-7522-97cf-1b67dabecf26
---
Target 2 of [[dabecf26]]. A mechanical codemod run once over the whole workspace (kept in the builder's scratch, not the repo): resolve each import that passes through a forwarding module to the defining file, rewrite the specifier, update `exports` maps, delete pure barrels and strip re-exports from mixed files. Leaves alone `archive/`, every file of `apps/tagma/inspection` and `packages/code-facts`, and imports into those two packages. Done when: the re-export count outside those exclusions is 0, every package typechecks, `bun run test` fails nowhere it did not fail at the base commit, and the refused/allowed specifiers of [[0d2c66a9]] are reported spelled for the new maps.