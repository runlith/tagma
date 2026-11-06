---
id: 01a14c08-8336-7b3c-965a-b09753f44cbc
title: A plugin adds its project section, side pane and separate window to the window, opened from the rail and the palette
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-76d6-793a-939b-838f9b8c75ed
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b09415a61526
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/plugin-views/windows
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugin-views/panes.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugin-views/SectionPage.svelte
  - kind: file
    ref: apps/tagma/app/src/routes/_desktop/view/[project]/[plugin]/[view]/+page.svelte
  - kind: file
    ref: apps/tagma/app/src/routes/[project]/p/[...path]/+page.svelte
  - kind: file
    ref: apps/tagma/desktop/src/viewWindows.ts
  - kind: file
    ref: apps/tagma/server/src/views/launchers.ts
  - kind: file
    ref: apps/tagma/server/src/views/sections.ts
---
**Value.** A plugin becomes part of the Tagma window: its own project section, a side pane next to the thread, or a separate window, opened from the rail and the palette.

**How.** The `surfaces` point (a project section on the `/<project>/p/<plugin>/<view>` route, a rail and palette item), `panes` (a side pane) and `launchers` (a palette action and rail button opening the view in a window). All reference views from `views`; the icon is a file in the plugin's `ui/`.

**Behaviour.**
- A view window on desktop is a bare OS window, on the web a floating project panel. The same view does not open twice but is brought forward; what the view asks to show (a thread) is shown by the main window, and if there is no main window, one opens on that path.
- A section does not follow the operator to another project and is not remembered as the last place: the plugin may be disabled there.
- A side pane closes when the plugin is disabled or stops contributing it; a transient crash or restart does not wipe the saved layout.
- A view may open its own section or pane itself — only on a click inside the view and only what the plugin contributes.

**Limits.** Views appear in a project where the plugin is enabled and running. The phone shell offers no plugin views.
