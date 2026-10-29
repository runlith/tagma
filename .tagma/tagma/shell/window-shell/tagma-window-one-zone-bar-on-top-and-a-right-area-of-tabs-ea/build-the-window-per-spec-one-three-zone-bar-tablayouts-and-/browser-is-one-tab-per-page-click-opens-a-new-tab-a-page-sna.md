---
id: 01a15644-1e17-7432-b4e2-2fc939719507
title: Browser is one tab per page, ⌘-click opens a new tab, a page snapshot under the menu over the right area
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15645-31a6-7ac6-94c9-7ba371d34477",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15622-e2ef-7840-b59b-5e32e200e09f
---
Part of [[e200e09f]]: the `browser` tab shows one page (the inner page strip in `ProjectPane` goes away), ⌘T is a new browser tab, ⌘W closes the page and the tab, closing an agent page's tab does not close the page. Links lead to the active browser tab, ⌘-click to a new one. While `SidePanes.covered`, the desktop native view is replaced by a page snapshot (`capturePage` via the bridge). A "browser" tool in zone B. Proof is typecheck and the owner tests.
