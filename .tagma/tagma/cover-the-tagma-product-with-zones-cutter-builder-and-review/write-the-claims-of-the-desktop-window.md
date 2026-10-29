---
id: 01a0ca95-3137-7af4-9615-9fecd476bf91
title: Write the claims of the desktop window
ord: 197
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0ca9a-7834-7592-96cc-6eb18aa01911",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca95-302a-761c-b835-d02e2f69b0c4
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
---
The whole module in one task, because it is about 900 lines: [[2f69b0c4]] and both areas beneath it, [[10464bfd]] and [[c04717c7]].

Read every tracked file under `apps/tagma/desktop` whole, including `src/SurfaceLoader.test.ts` and `src/installation.test.ts`, which run under Bun's own runner rather than Vitest. There is no Svelte here.

Five boundary claims already stand on the module and were verified in the cut: the detached start, the once-per-window-life rule, the named-address case, the type-only bridge with its sandboxed preload, and the two bundle identities. Do not restate them — write what the areas hold that they do not: what the waiting page says in each of the loader's six standings, how an absent part and an unreadable one are two different answers, and what the build does about a fresh checkout that carries a package without its binary.

The module depends on [[59160e8b]], [[fdc8aed8]] and [[883b9c98]]; reference what those kits claim rather than restating it.

Done when: the claims are written from the code and verified, the doctor over `apps/tagma/desktop` is clean, and a review passes.