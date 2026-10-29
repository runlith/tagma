---
id: 01a14028-2a07-7ffe-8f7f-2d2da43e08a7
title: "`platforms` reads SvelteKit in its own code: `svelte.config.js`, `+page`/`+layout` route files, the `$lib` prefix, the `svelte` condition"
ord: 59
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f95-99b8-7325-8d9a-d0a769566ef9",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14022-3fdc-7998-a972-6ed7cd1d69bf
sources:
  - kind: file
    ref: apps/tagma/inspection/src/packs/js/platforms/routes.ts
  - kind: file
    ref: apps/tagma/inspection/src/packs/js/platforms/starts.ts
  - kind: file
    ref: apps/tagma/inspection/src/packs/js/platforms/walk.ts
---
Framework knowledge in `platforms` code, against rule 6f758080: `kit.ts` reads `svelte.config.js` and its `kit` field; `starts.ts` recognizes SSR routes with the `+page|+layout|+error` regexp; `walk.ts` names `svelte.config.js` and gives the `$lib` prefix special handling; `declaration.ts` hard-codes the `svelte` export condition. Found by review cd1d69bf, which removed only the bundler-query knowledge from the code.

To do: reading the application config and route rules becomes an adapter behind the `platforms` contract (or rule data), the core keeps no framework branch. Check: a `platforms` test with an app of another framework, declared by data or its own adapter only, with no core edit.
