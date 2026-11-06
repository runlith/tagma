---
id: 01a174c2-6fdc-7705-9ee5-5d7885824838
title: ⌘W closes the innermost focused thing, and the window only when nothing is left to close; desktop cancels it for the menu and delivers it to the page as a press
ord: 28
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/files/TabKeys.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/keys.ts
  - kind: file
    ref: apps/tagma/desktop/src/interception.ts
  - kind: file
    ref: apps/tagma/desktop/src/menuKeys.ts
---
Desktop's menu holds ⌘W (Close Window, Ctrl+W off macOS), and left alone it would close the window ahead of the page. Main therefore cancels, in the window's `before-input-event`, every chord the page published as `claimed` that the built application menu also holds (`menuKeys.ts` reads the built menu's accelerators and Electron's role defaults, plus AppKit's Show Tab Bar ⇧⌘T on macOS), and sends it over the `keys` bridge as a press `{ chord, page: null, frame: null, global: false }`. The page's action chain runs; the document's `keydown` never sees the press, so a handler listening on the DOM — terminal input, checkout tab keys — never hears it. A place that closes its own on ⌘W while focused registers a handler for `tab.close` and checks focus itself: the browser page on the right, the terminal pane on the right and in the bottom panel.

The chain runs from the inside out: handlers of the focused place; the right-area tab when focus is in it; the active file tab on the checkout screen; the active shown tab of the right area; and only when there is nothing to close the window, through `DesktopTabs.closeWindow`. The last tab and the window never close on one press. ⌘W stops no thread, agent, or server: a thread tab only leaves the view.

A chord the page published but did not claim stays with the page: its handlers decline when their pane is not focused, and main cancelling it would take the menu action (zoom, reload) away with nothing to take its place.