---
id: 01a14c08-8336-7b3c-965a-b09001208e3e
title: The operator finds the thread's and its agents' pages in the Pages submenu of the “This thread” button, holds a page as a tab next to the thread, and sees all server pages via index and tagma artifacts
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-76d6-793a-939b-838f9b8c75ed
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b08f2e1bad5a
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/pages
  - kind: file
    ref: apps/tagma/app/src/lib/app/artifactLinks.ts
  - kind: file
    ref: apps/tagma/server/src/artifacts/cli/list.ts
  - kind: file
    ref: apps/tagma/server/src/artifacts/contract/wire/operations.ts
  - kind: file
    ref: apps/tagma/server/src/composition/http/artifacts.ts
---
**Value.** The operator finds pages published by a thread and its agents without scrolling the feed for a link, and keeps the needed page next to the thread.

**How.** A Pages submenu of the "This thread" button in the thread header, with a page count: pages of the thread itself and its whole team, with author and time; the description — in the row's tooltip. The address is copied by the hover button on the row or ⌘C (Ctrl+C outside macOS) on the selected row; the menu stays open. A new page is marked by a blue square at its row and on the "This thread" button; the marks fade once the submenu is closed. A page from the Pages list and from a feed card opens as a tab in the right area; ⌘-click on a list row (Ctrl outside macOS) and the card's outward-arrow button open it in the system browser. All server pages — by the index at the pages port root, the `tagma artifacts` command and the `list_artifacts` operation (the agent gets it too).

**Behaviour.**
- The thread list is live: a publish in the team updates it at once. A page published from several threads goes to the open thread.
- A page tab shows its current version and moves to the new one on its own when the page is republished; motion plays in the tab in the player. The tab stands in the thread's layout and survives a window reload; until the server answers about the page, the layout does not lose it.
- A document in the tab zooms like a built-in browser page: with tab-header buttons and ⌘+, ⌘−, ⌘0 (Ctrl outside macOS) while focus is in the tab, including inside the page itself — the Tagma window zoom does not change. The zoom is remembered per page and kept across reloads. Motion does not zoom: it already fits the tab.
- From the phone, pages open through the remote door: the app translates a click on a local-port link to the same path of its door, and there the page is also served inside the sandbox.
- The browser index reads 50 rows per page, so one long view does not turn the whole shelf into DOM; a Next link continues the walk. Browser and `list_artifacts` read the shelf as it was on the first page; index compaction makes the cursor stale: the browser offers to reopen the shelf, the CLI restarts the walk on its own.

**Limits.** Past versions are reachable only by direct address `/a/<id>/v/<version>` and in the feed cards that published them: neither the Pages list nor the CLI enumerates them. A tab opens from a card and the Pages list; the right-area "+" menu does not offer it. On the phone there is no right area: a list row opens the page as a link. Copying an address in the Pages list on the phone puts the server's local address into the clipboard, which does not open from the phone: translation to the remote door only fires on click; card and tab copy the door address. In the web version, a shortcut pressed inside the page zooms the browser tab: only desktop can intercept it from the frame; tab buttons work everywhere.
