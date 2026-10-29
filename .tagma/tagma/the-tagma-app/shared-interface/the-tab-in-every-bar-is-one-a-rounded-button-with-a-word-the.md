---
id: 01a17329-c337-7a64-a107-fae3ce1ea6a4
title: "The tab in every bar is one: a rounded button with a word, the current one on bg-selected, gold only at the place tab"
ord: 10
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a16637-60ed-76a9-b850-9818aa7abca9
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/shared/TabRail.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/shared/ui/tab.ts
  - kind: file
    ref: apps/tagma/app/src/lib/shared/ui/ViewTab.svelte
---
Projects, the right area, files and terminals draw one `TabRail` tab, and standing view sets (Files / Search / Git, palette groups, agent views) — the same tab without icon and cross (`ViewTab`); both dress in one (`tabLook`). Before, there were four shapes: flat cells with vertical lines, a plaque with a shadow, segments and an underline. A shadow in Tagma means "hovers over the window", so only the dragged tab carries it; the choice is a translucent backing, visible on any surface, unlike a page-background fill.

The tab's height is set by the bar: the tab stretches along it with a 4 px inset top and bottom. State marks on a tab are squares. An open tab's cross is always visible: it is already chosen, and there is no need to hover it to close. The rest show the cross on hover or focus. In both cases it stands over the tab's end, the caption under it fades (`fade-under`), and there is no room for it.

When tabs overflow, the bar edge fades 24 px wide (`rail-scroll`), and the current tab scrolls into view with a margin of the same width (`scroll-mx-6`). Without the margin it stood flush with the edge, and the fade dissolved its flooded end together with the cross. Now only the neighbouring tab falls under the fade, with only its caption dissolved. Overflow is counted by tab layout, not `scrollWidth`: while gliding after closing or reordering (`glide`, 150 ms) the tab's shift inflates `scrollWidth`, a measurement at that moment set the end fade, and after the animation nobody removed it — the open tab's cross stayed dissolved.

The gold mark at the bottom edge (`RailMark`, `edge="bottom"`) stands only where the tab is the place the reader stands in: at the current project (`here`). A file, terminal and panel show what is open in their container; gold on them would give several "you are here" marks in one window.
