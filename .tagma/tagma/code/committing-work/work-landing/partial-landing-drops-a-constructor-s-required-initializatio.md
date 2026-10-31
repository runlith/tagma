---
id: 01a19417-0dc3-7fcd-b16d-a88fd0d50427
title: Partial landing drops a constructor's required initialization after a peer extends it
ord: 169
tags: ["reflection"]
fields:
  {
    "actual": "Commit 84d2facc40 added Render.hydration and hydrationData() but left begin() with no parameter and an initializer lacking hydration, while carrying render's begin(data, signalFactory) call; two committed API/type errors required repair commit 9a18ef5268.",
    "command": "submit_work({\"subject\":\"feat(ssr): serialize scoped hydration data with csp support\",\"body\":\"Keep hydratable values and nested promise serialization in the render scope, emit the caller's data format with nonce or exact-body CSP hashes, and bind client data to its consuming roots. Preserve per-call format isolation, retire resumed hydration segments independently, and dispose rejected hydration roots. Expose the adapter format and compatible conditional entry signatures for Kit's native runtime integration.\",\"tasks\":[\"34d8c1ab\"],\"paths\":[\"packages/vigla/package.json\",\"bun.lock\",\"packages/vigla/src/runtime/server/hydration.ts\",\"packages/vigla/src/runtime/server/context.ts\",\"packages/vigla/src/runtime/server/render.ts\",\"packages/vigla/src/runtime/dom/data.ts\",\"packages/vigla/src/runtime/dom/mount.ts\",\"packages/vigla/src/runtime/dom/hydration.ts\",\"packages/vigla/src/runtime/dom/async.ts\",\"packages/vigla/src/entries/index.ts\",\"packages/vigla/src/entries/index-server.ts\",\"packages/vigla/src/entries/server.ts\",\"packages/svelte/src/shared/format.ts\",\"packages/svelte/src/compiler/index.ts\",\"packages/svelte/src/entries/index.ts\",\"packages/svelte/src/entries/server.ts\",\"harness/manifest/own/runtime.json\",\"harness/samples/own/runtime/hydration-mode-overlap\",\"harness/samples/own/runtime/hydration-mismatch-lifetime\",\"harness/samples/own/runtime/hydration-promise-graph\"]})",
    "expected": "Preserve the selected hydration context parameter and initializer, carry the dependent peer extension consistently, or refuse the incomplete slice before publishing."
  }
---
Filed from project `vigla`. Received by a server up since 2026-10-31T17:51:49.846Z, from 3a395b0b3.

The session first changed begin() to begin(hydration: Data | null = null) and initialized the hydration field. A peer then extended those same lines with an optional signal factory. The working tree passed both package tsrs checks. submit_work selected both context.ts and render.ts, credited carried peer lines in render.ts, but omitted the required constructor lines in context.ts. git show of the landed tree established the mismatch. A whole-file landing of context.ts and its coupled server entry fixed it without reverting either author's code.