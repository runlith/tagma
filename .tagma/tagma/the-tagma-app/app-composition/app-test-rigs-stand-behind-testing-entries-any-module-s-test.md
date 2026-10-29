---
id: 01a174f8-8de8-7c5e-8d47-febeb2433af7
title: "App test rigs stand behind testing-entries: any module's test takes them with no relation, code never does"
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/slotWorld.ts
  - kind: file
    ref: apps/tagma/app/src/lib/app/TestHost.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/testing.ts
---
A lower feature's test assembles a world from real modules, and only composition, which stands above all, can assemble it. So the rigs lie behind testing-entries: `testing.ts`, `slotWorld.ts` and `TestHost.svelte` at composition, their own doors at wire, panes, providers, threads (`native/testing.ts`), executions (`worktrees/testing/`) and browser (`testing/`). Any module's test code imports such a door with no relation, and that creates no cycle: testing-entries and imports-tests never close a cycle. Code outside tests cannot import it; that is a module-inspection refusal.

A file under a testing entry counts as test code itself: its imports follow its module's imports-tests, so the composition rig can pull `@runlith/testing` and doubles missing from its imports. `*.fixture.svelte` does not count as test code and imports only through its module's regular relations.
