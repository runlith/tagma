---
id: 01a14bef-d7d1-7174-ba8f-eb6ec680bdd6
title: "Three live-run defects of `own-ui`: agent-library draft Escape, repeated \"Discard this draft?\" prompt, terminal menu keyboard"
ord: 3
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14b1b-14eb-75f6-a49c-49128beaa2fe
---
The live run of the `own-ui` branch found three defects. Each is fixed at its owner, each has a test, red before the fix.

- Escape on an unsaved draft does not ask "Discard this draft?": the stack hands Escape to the dialog with the `ignore` policy and calls `preventDefault`, while the library listened for Escape on window and skipped a consumed one. A dialog that refused Escape calls its owner's `onEscapeIgnored`, and the library asks the question from there — wherever in it focus stands.
- The question does not reopen after Escape, ✕, or a backdrop click: the dialog root first called `onOpenChange`, then wrote its own `open`; writing to a derived prop on a dirty chain above lost the owner's subsequent value changes. The root writes `open` before notifying, like menu, popover, and select.
- The terminal menu never receives the keyboard: the menu focus effect lived in the app root and ran before the portal root removed `visibility:hidden`, so the browser never set focus. The effect lives in the surface attachment. Measured in Chromium: without the fix, `focusSafely` from `Menu.enter` ran on a surface with `visibility: hidden` and never took focus; with the fix — one focusin on the already visible menu surface.

Plus: the stack spec on focus-outside is reconciled with the code (a layer that took focus above does not close the ones below), `z-50` on the palette and the library is removed.
