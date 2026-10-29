---
id: 01a0c848-88ae-7f32-b700-78d6b10b9de7
title: Remove the unreachable syncOpenState doors
ord: 25
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0c83d-a8fe-7fe8-bbce-e28c127dbea9
sources:
  - kind: file
    ref: packages/primitives/src/SnackBarHost.svelte
  - kind: symbol
    ref: packages/primitives/src/DialogRegistry.svelte.ts
    symbol: syncOpenState
  - kind: symbol
    ref: packages/primitives/src/Snackbars.svelte.ts
    symbol: finalizeClose
  - kind: symbol
    ref: packages/primitives/src/Snackbars.svelte.ts
    symbol: syncOpenState
---
`Dialogs.syncOpenState` and `Snackbars.syncOpenState` are public methods of two exported services that nothing calls. Measured 2026-09-22 across the whole repository, tests included: `git grep -rn syncOpenState` finds only the two definitions — no host, no suite, no consumer, and `apps/tagma/app` is the package's only consumer.

The dialog one used to carry a comment naming a `bits-ui` caller that never existed; the prose strip in 0b3f108d7e removed it (verified 2026-09-26: no `bits-ui` mention remains in `packages/primitives/src`), and [[a0a9bf2a]] now records why the sync door is never called. The removals below are what remains of this task.

The same reading found `Snackbars.finalizeClose` unreached: the dialog transport's namesake is called by `DialogHost.svelte`, but a snack bar finalizes inside its own `closeById` — leaving the document and being closed are one moment for it — so no host ever needs the public door. That one is a judgement rather than a certainty, since it is a plausible API for a host somebody may yet write; the two `syncOpenState` methods are not.

Remove both `syncOpenState` methods. Decide `Snackbars.finalizeClose` deliberately — remove it, or give it a reason to be public that its sibling's asymmetry does not already answer. Confirm the package's own suite and typecheck stay green; no test references any of the three.
