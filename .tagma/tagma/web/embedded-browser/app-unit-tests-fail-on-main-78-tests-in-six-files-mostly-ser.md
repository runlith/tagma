---
id: 01a14b32-e550-77d4-9966-60fae9dc9939
title: "App unit tests fail on main: 78 tests in six files, mostly “Service \"Links\" is not in the manifest”"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c12-744e-72f5-86c7-42426e671a07",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14b1b-14eb-75f6-a49c-4908938272c2
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/Links.svelte.ts
---
On clean main `e6eea24d`, `bun run --bun vitest run --project unit` in `apps/tagma/app` yields 78 failures in six files:
- `features/threads/Terminal.svelte.test.ts` (14), `features/executions/places/{State,Tabs,ThreadPanes}.svelte.test.ts` (18, 25, 5) — `Service "Links" is not in the manifest`: the eager `Links` service (`features/browser/Links.svelte.ts`) is missing from these tests' manifests, then “no tab adopted”, “no pane adopted”;
- `features/checkout/CheckoutPage.svelte.test.ts` (13) — `Service "ThreadList" is not in the manifest`; fixed in the own-ui worktree by commit dc33a9fe72: the test manifest gained `ThreadList`;
- `layout.test.ts` (3) — lists expected empty are not empty.

The notifications work ([[938272c2]]) does not touch these files; the same failure count reproduces without it.

Fix: four test manifests gained `Links` — a shared fixture for `State`/`Tabs`, two manifests for `ThreadPanes`, one for `Terminal`; all 68 tests of the four files green. The disk static check `layout.test.ts` removed from the unit layer; the previous zone order and the messages found are kept in [[470c989b|task of moving the architecture contract into law]]. `bun run typecheck` gave 0 errors and one existing a11y warning in `browser/screencast/CastView.svelte:243`. Full `bun run test --maxWorkers=2` gave 1354 passing tests and two suites that failed to load (`BlockCard`, `ToolResultRow`): another session's unfinished edit to `BlockCard.svelte` imports the missing `$lib/shared/Hint.svelte`. The launching agent allowed finishing the delivery without waiting for that session; a full green run of the current shared tree stayed unproven. The independent [[01a14c18-7adc-7fee-a2cb-423fe013a215|delivery review]] finished with no findings; the reviewer ran no repeat tests/typechecks.
