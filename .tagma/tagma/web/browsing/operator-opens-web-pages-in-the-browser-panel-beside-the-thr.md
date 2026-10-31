---
id: 01a14c08-1c3f-7bde-a2e3-0462886d0b63
title: "Operator opens web pages in the browser panel beside the thread: tabs, address bar, find, zoom, DevTools, and downloads"
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046371947f5b
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-0469ea44a461
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046a6700af16
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046b8ddec8bc
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046c485baab2
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046ed78e542a
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/actions.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/Downloads.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/PageFind.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/panes.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/ProjectPane.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/TabStrip.svelte
  - kind: file
    ref: apps/tagma/desktop/src/browser/menu.ts
  - kind: file
    ref: apps/tagma/desktop/src/browser/panels.ts
  - kind: file
    ref: apps/tagma/desktop/src/browser/popups.ts
  - kind: file
    ref: apps/tagma/desktop/src/browser/profiles.ts
---
**Value.** The operator views sites, docs, and their own dev server without leaving Tagma: a page stands as a panel beside the thread, not in a separate system-browser window.

**How.** The "Open the browser beside" palette action or a link opens the browser side panel: tab strip, back/forward/reload/stop, an address bar whose list, shown under it as the operator types, offers what Enter does, the project's terminals serving a local port, open pages and recently closed ones, an "open in system browser" button. Keys ⌘T, ⌘W, ⌘⇧T (reopen the last closed), ⌘L, ⌘[ / ⌘], ⌘R, ⌘F. Under the panel are the `open_page`, `navigate_page`, `close_page`, `list_pages`, and `read_page_downloads` operations.

**Behaviour.**
- The panel tabs are all open project pages, including ones opened by agents; such a tab carries an "Opened by" label with the thread name. A new page opens in the profile picked on the blank page, otherwise in the `browser.userProfile` profile; a page in another profile names it in the address field.
- On desktop the page shows natively; it also has find in page, zoom, and DevTools, and a context menu (open link in a new tab or in the system browser, save image, Inspect Element). In the web client the same panel shows the page by screencast, with no find, zoom, or DevTools.
- A link with `target=_blank` becomes a new tab right after the tab of the page that opened it, in every window showing that tab. A plain click switches to it when the operator was looking at the opener; ⌘-click, a middle click or "Open link in new tab" leaves it behind, and so does a click an agent made. When no window shows the opener's tab, the page goes to the thread that opened the chain. A named-window popup opens in its own window with an origin strip. A page opens a window without a user gesture only within a small quota.
- A page no one sees, drives or captures rests like a background tab and costs almost no CPU or GPU.
- Microphone and camera are first granted to a site by a human, per origin and only in a shown window; a background page or one under an agent is refused without asking.
- Page downloads gather in a badge with a count; a finished file saves with a Save button. A page keeps its last 50 downloads.

**Limits.** No bookmarks, visit history, or sync; URL suggestions come only from the project's terminals serving a local port, open pages and the project's last 20 closed pages. There is no panel on the phone — the Pages section stands there instead.
