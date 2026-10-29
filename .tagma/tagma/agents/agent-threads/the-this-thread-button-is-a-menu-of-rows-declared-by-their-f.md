---
id: 01a17512-00c9-7b2f-828a-8e89a7c2a8cc
title: The "This thread" button is a menu of rows declared by their features; the thread decides only their order, owner projections decide visibility
ord: 1
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1744e-1362-7314-8205-5ff9ce1ef098
  - kind: relates
    to: 01a174df-7c1c-7a0c-9397-47b788d717d0
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/ChangesCount.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/ChangesItem.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/changesTail.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/pages/PagesMenu.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/ThisThread.svelte
---
Checkout draws the Changes row (`ChangesItem`), pages draws the Pages submenu (`PagesMenu`), threads draws the working-agent rows (`TeamMember`). Each reads its own projection in the thread scope held by the header (`ThreadHold`), and `ThisThread` only places them into sections. The same projections decide the button and row visibility: `ThreadChanges.empty`, `ThreadPages.total`, the team's working agents. `ThreadChanges.empty` also decides "No changes yet" in the Changes tab itself, so the row does not vanish while the tab shows something. If the button computed its own "is there anything to show", it would open an empty menu or hide a row the feature draws. A new thing the thread does becomes its feature's row here, not an icon in the header. One exception is the thread's uncommitted-changes count (`ChangesCount`): it stands in the header left of the button while `ThreadChanges.empty` is false and this thread's Changes tab is off-screen — that is, while the shown layout's holder is not this thread or its active visible tab is not Changes (`SidePanes.holder` and `SidePanes.shows`). When the Changes tab is on screen, the same total stands in its Uncommitted section header, and a second count in the header would repeat it.

Changes and agent rows are links under the link rule: click — beside, ⌘-click — full place, right-click — link menu. Click and Enter take `linkTarget`, other menu picks — space and releasing the pointer dragged from the button — take `linkSelect`. The rows themselves do not close the menu (`closeOnSelect={false}`); `onLinkOpened` closes it. So it closes after any opening, including via a link-menu item, while opening the link menu does not close it. A page row opens the page itself and closes the menu through `onOpened`. Copying the address — with the hover button or ⌘C on the selected row — does not close the menu and flashes a checkmark.

Pages are marked seen when the Pages submenu closes, not the whole menu. Otherwise the blue mark would fade for an operator who opened the menu for changes and never saw the pages.

The Changes tail is the `+/−` sum of the thread's uncommitted lines from the `thread.changes` frame: the stream already carries it and counts it on the server. With no lines the tail is the file count, with neither the unchecked-path count. No second read happens for the tail. The same `changesTail` and `threadChangesLink` decide the tail and the link, and one `ChangesTail` draws them: the menu row and the header count read them, so they never diverge. The header count is the same `changes`-kind link as the menu row.
