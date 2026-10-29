---
id: 01a13bf1-b503-7743-bd05-8779b54911b3
title: "Back and forward on desktop: arrows in the header, ⌘[ / ⌘] and mouse buttons"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13be3-ef0c-7834-b903-8c65383a654d",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/Shell.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/TopBar.svelte
---
On desktop a window has no browser buttons, so there is nothing to walk the address history with. The web version walks the same history with browser buttons.

What to do:
- Two arrows in `TopBar` after the window-button indent, before the project switcher. Only when `host.kind === 'desktop'`. Dimmed when there is nowhere to go (`navigation.canGoBack` / `canGoForward`); the step is `Router.traverse(±1)`.
- Shortcuts in `Shell`: `⌘[` / `⌘]` on macOS, `Alt+←` / `Alt+→` on Windows and Linux, desktop only. If the focused widget already took the key (`defaultPrevented`), there is no navigation. Side mouse buttons 4/5 work too.
- The code editor yields `Mod-[` / `Mod-]`: indentation stays on Tab / Shift+Tab (`indentWithTab`).
- The terminal takes `⌘[` / `⌘]` only when there is a split to move to.

Done when: typecheck is green, and on desktop the arrows, keys, and mouse walk the history — including from an open file. Inside a terminal with splits the keys still switch panes.

The design was agreed with the operator on page http://localhost:5634/a/b87255e1bf72.
