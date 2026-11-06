---
id: 01a0caab-e793-7a3f-a43a-b4a1b93b3cfb
title: The palette builds project-defaulted links on global pages, aiming at project "undefined"
ord: 1
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/CommandPalette.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/address.ts
---
The address vocabulary's project default reads `page.params.project as string` (`here()` at address.ts:35). On global pages it is `undefined`: the command palette opens app-wide from the root layout with no route guard (⌘K — only the sidebar chord is gated), and it builds `blockHref(name)` (`CommandPalette.svelte:93`) and `surfaceHref(surface)` (`:99`, when `page.params.project` is undefined) on the default. On `/settings` the default is `undefined`, so the palette's block and surface links aim at project `"undefined"` instead of the frame's project.

Either end is a real fix and this task is to decide which: the palette passes the frame's project explicitly (or does not offer project links where no project segment stands), or the default refuses outside `[project]` so the next app-wide caller fails loudly instead of linking `"undefined"`. Siblings that render app-wide (`JournalPulse`, `PanelHeldPaths`, `NavigationRail`) all name the project explicitly and stay as they are.

Found by the zone review of [[f0bc5c8a]] for [[a014cd4c]]; it implements no decision of its own. Done when the palette's links aim at a real project from every page it opens on.