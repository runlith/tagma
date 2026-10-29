---
id: 01a16164-555e-783a-b03d-6e2dbe7f3499
title: "One effect's exception freezes the whole window until reload: failure boundaries per interface unit and window failures in the Errors list"
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16164-9a56-74b5-9290-89b9c3134a68",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/FaultsButton.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/Root.svelte
  - kind: file
    ref: packages/chat-ui/src/TranscriptRow.svelte
---
**Case.** 2026-10-22 02:02:52Z, the "Rules" thread (01a1550c), turn 01a16158. On screen the feed froze on the `spawn_agent` row: the running verb "Starting", the "Loading thread…" chip, the "· 0:00 · run 11s" tail. The row and turn clocks ticked no more. An empty band of the old height stayed above the row. Later the thread header menu pressed but no popup appeared. Everything cleared only after the window reloaded. On the server the same call stands `output-available`, followed by the recorded answer, the turn's end at 02:03:00 and the next turn 01a16159 — the client never showed them.

**Mechanism (reproduced).** In Svelte 5.57 (async mode; upstream `main` is arranged the same) an effect throwing with no `<svelte:boundary>` leaves its root's effects unrun forever. A probe in `packages/layer` (jsdom, vitest): after the throw, a neighbouring `$effect` of the same `$effect.root` ran on neither of the two following writes; an independent root's effect kept working. The app has not a single `<svelte:boundary>`; all components stand under one `App.mount` root, graph services in detached roots. So one exception in any component freezes the whole visible interface until reload, while data keeps arriving. The menu does not open because mounting the popup holds a `$effect.pre` in `dropdown-menu-content.svelte` inside the frozen tree.

**What we do not know.** Which effect threw. Renderer exceptions are saved nowhere: `Failure.report` rethrows to the console by default, nobody listens to `window.onerror`, the Errors list shows server defects and the window's `notices.faults`, and `FaultsButton` itself stands in the same frozen tree.

**To do.**
1. One interface part's failure does not freeze the rest: `<svelte:boundary>` boundaries along independent units — the chat feed row (`packages/chat-ui`, `TranscriptRow`), the app shell areas (thread column, thread list, right area, overlays) and the root. Each boundary has a visible `failed` view with its own message and `reset`.
2. Every boundary-caught failure and every unhandled window exception lands in the Errors list as a window failure: place (component stack), message, stack, ×N. Then the next case will name the throwing effect.
3. A public-contract test: an exception in one feed row leaves the rest of the feed alive (a later write renders), and the failure is visible in Errors.
4. For the found exception — fix the throwing effect itself at its owner.
