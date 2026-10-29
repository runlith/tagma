---
id: 01a123ed-cb7e-78ac-ada9-710b8a5f13b6
title: Every cut keeps its own temporary SvelteKit build inside the checkout
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/svelte.config.js
  - kind: file
    ref: apps/tagma/server/src/installation/cut/release.ts
---
SvelteKit reads server chunks, the client manifest and fallback pages at different steps of one build. A shared intermediate directory lets another cut delete or replace part of that generation even with different end directories. Release carves a temp directory inside the app's `.svelte-kit`, passes its physical path through `TAGMA_SURFACE_WORK`, and deletes it when the surface step's scope closes, including refusal and cancellation. The directory stays inside the checkout because the SvelteKit postbuild resolves server chunks' external dependencies through the neighboring `node_modules`; a path outside the checkout breaks that boundary. Dev and sync keep their own `.svelte-kit`.
