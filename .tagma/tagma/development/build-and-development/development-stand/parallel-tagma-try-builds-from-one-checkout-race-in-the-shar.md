---
id: 01a123e5-3ec9-72a5-abd7-a93782682ab7
title: Parallel tagma:try builds from one checkout race in the shared apps/tagma/app/.svelte-kit and release a broken shell
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a123e5-5ccb-7536-9ba6-0faed8f624ee",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a123c4-59f2-7742-abe2-57993c3fd3e3
sources:
  - kind: file
    ref: apps/tagma/app/svelte.config.js
  - kind: file
    ref: apps/tagma/server/src/composition/cut/try.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cut/engine.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cut/release.ts
  - kind: file
    ref: packages/speech-whisper/scripts/build.ts
  - kind: file
    ref: packages/speech-whisper/src/artifact.ts
---
Two independent observations within half an hour with several agents building their own `tagma:try` at once: (1) plugins-wiring — the surface build fell with `SyntaxError: ENOENT reading apps/tagma/app/.svelte-kit/frozen/output/server/chunks/internal2.js` (`cut-failed`); (2) plugins-speech — the built shell is white, `Cannot read properties of undefined (reading 'data')` in SvelteKit start: the index from one generation, chunks from another. Both builds write into the app's shared output directory in the checkout. Done when two `tagma:try` builds (or any cut) run at once from one checkout each yield a whole shell — a test or a reproducible check with two parallel builds — without serializing every build on the machine, if the build's own output directory solves it cheaper.
