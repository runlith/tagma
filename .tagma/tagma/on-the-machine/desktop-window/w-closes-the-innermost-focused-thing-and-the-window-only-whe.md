---
id: 01a174c2-6fdc-7705-9ee5-5d7885824838
title: ⌘W closes the innermost focused thing, and the window only when nothing is left to close; desktop intercepts it before the page
ord: 28
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/files/DesktopTabKeys.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/keys.ts
  - kind: file
    ref: apps/tagma/desktop/src/tabKeys.ts
---
Desktop catches ⌘W (Ctrl+W off macOS) in the window's `before-input-event` and cancels the event, otherwise the menu role would close the window ahead of the page. So the press never reaches the app document's `keydown`, and a handler listening on the DOM — terminal input, checkout tab keys — never hears it. A place that closes its own on ⌘W while focused declares it as a binding in `Keymap` and checks focus itself: the browser page on the right, the terminal pane on the right and in the bottom panel.

The `close` command is parsed by `DesktopTabKeys` from the inside out: `Keymap` bindings; the right-area tab when focus is in it; the active file tab on the checkout screen; the active shown tab of the right area; and only when there is nothing to close — the window. The last tab and the window never close on one press. ⌘W stops no thread, agent, or server: a thread tab only leaves the view.
