---
id: 01a1613d-8864-7cd6-b0fa-d0a9ec6237de
title: Move svelte-check for Svelte packages from TypeScript 6 to the TS 7 engine, if it finds the same errors faster
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1613e-6093-78f6-88e9-6da068f7fc60",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1612d-2135-7f12-8deb-91b934378e8f
---
`.ts` packages are checked with `bun check`, which tracks TypeScript 7, while Svelte packages use svelte-check 4.7.6 on the TypeScript 6.0.3 JS engine. svelte-check has two TS 7 modes: `--tsgo` (svelte2tsx-converted files are written to disk and checked by tsgo) and `--tsgo-experimental-api` (they are fed into the TS 7 API). Measure both on `packages/chat-ui` and `apps/tagma/app` against the current setup: time and error list. Sensitivity is checked on a small project outside the repository with deliberate errors in `.svelte` (in script and in template) and in a `.ts` file importing them. The mode that produces the same error list faster becomes the typecheck command for all Svelte packages in `packages/tsconfig/src/typecheck.ts`; otherwise, a report of the divergences. The work includes upgrading to svelte-check 4.7.7, a Bun patch fixing the TS 7 API, and a unified single-line diagnostics output from machine-verbose in bun check format. Chosen: the fixed API mode — chat-ui 3.19 s instead of 7.25 s, app 14.12 s instead of 42.84 s with the same diagnostics list; sensitivity keeps the three original errors plus an independent syntax error. Full outputs, reasons for rejecting --tsgo, and measurement conditions are stored in [[044c3891|comparison results]]. Root `bun run tagma:typecheck` passed in 93.25 s, exit 0; both findings of the independent review are fixed.
