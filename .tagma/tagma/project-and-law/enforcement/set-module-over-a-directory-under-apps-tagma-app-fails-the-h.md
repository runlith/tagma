---
id: 01a119ca-a4a8-739c-8fb6-1ccaf564b376
title: "set_module over a directory under apps/tagma/app fails: the HEAD tree has no generated .svelte-kit/tsconfig.json"
ord: 101
tags: ["reflection"]
fields:
  {
    "actual": "refused[inspection-failed]: the inspection over  at ea00c374 failed (source): apps/tagma/app/tsconfig.json: Cannot read file '/apps/tagma/app/.svelte-kit/tsconfig.json'. The app's tsconfig extends a generated file that the materialized HEAD tree lacks; the same refusal came at d1a5dd62, so it is not transient. create_block refuses a module card (operation-only), so no road writes a card under the app.",
    "command": "set_module with a new module rooted at apps/tagma/app/src/lib/features/threads (id thread-view, entries \".\", imports of the kits and server modules the directory imports)",
    "expected": "The card is written and every enforced rule whose map moved is measured at HEAD, naming the crossings it records."
  }
---
Filed from project `runlith`.

Blocks the thread-view card of task db527d85 (spec e5e1e307, parent d68e71ff acceptance). Needs either the measurement tree to run svelte-kit sync before reading tsconfig, or the inspection to treat an unreadable generated extends as absent.