---
id: 01a1564d-b771-7601-a8b2-ab894cc3172a
title: Tab layouts live under one key per holder, with no shared index, and are swept by walking keys by age and count
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/panes/TabLayouts.svelte.ts
---
The key is `tagma.tabs:<projectId>:<holder>` (a thread, `new:<projectId>`, `section:<section>`), and the value carries a last-used mark. There is deliberately no shared index: the desktop holds several project windows over one `localStorage`, and an index write by one window would wipe out holders written by another. So sweeping needs a prefix walk over keys (`PlatformStorage.keys`): at startup `TabLayouts` deletes keys older than 30 days and beyond 500 per project, oldest first. 500 layouts of a hundred bytes or two stay under 1 MB of the ~5 MB per-origin budget on any machine. The layout also keeps the recent-tab order: closing the active tab returns to the tab the operator worked in before it (for example, from a file opened out of Changes — back to Changes), not to the strip neighbour, including after a reload. For one layout in two windows the last write wins; a window re-reads it on the `storage` event.

A thread born from a draft carries the `new:<projectId>` layout onto the thread's key in the same step as the navigation (`SidePanes.carry` from the main slot's writer): otherwise the born thread would open without the tabs gathered in the draft.
