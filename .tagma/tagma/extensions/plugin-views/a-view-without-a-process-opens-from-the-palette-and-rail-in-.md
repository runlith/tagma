---
id: 01a123c2-ecd7-756d-bc1a-03782ecfcfcd
title: "A view without a process opens from the palette and rail in a window: an OS window on desktop, a floating panel on web"
ord: 3
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a123b1-a094-72bd-b4ab-f7606307a615
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/plugin-views/windows
  - kind: file
    ref: apps/tagma/desktop/src/viewWindows.ts
  - kind: file
    ref: apps/tagma/server/src/views/launchers.ts
---
Launching a view without a process is the `launchers` point (`{view, title}`): a palette action and a rail button open a plugin view in a "window". A window is one `ViewWindows` port with two adapters, and the client core never branches by platform: composition picks the adapter by `window.tagmaDesktop`.

On desktop the OS window is opened by the main process (`desktop/src/viewWindows.ts`): a separate `BrowserWindow` loads the `_desktop/view/<project>/<plugin>/<view>` route of the same surface, which holds only the view without shell chrome. Main accepts from the renderer only a path under this prefix plus a client path for showing in the main window, and checks the sender against the surface origin: otherwise a page that received `tagmaDesktop` would open a window with any address. The same view in the same project never opens twice — it brings the open window forward. What the view asks of the shell (`tagma/open` thread) the window does not do itself: it asks the main window to show the path, and when the main window is gone, main opens it directly on that path: the view window has neither rail nor side panes. A window whose page failed to load is closed, so a relaunch opens a new one instead of bringing a dead one forward.

On the web a window is a floating panel (`FloatingPanels`): the app-tier service holds state, and `PanelLayer` renders in the project shell. The panel belongs to the project it was opened in: it is hidden in another project and stands in place on return. Panel order in the DOM never changes when brought forward (z-index), because moving an iframe in the tree would reload it. Closing a window, panel or page removes the view mounting with the bridge and subscriptions: for a panel that is an ordinary `ViewFrame` unmount, for an OS window it is the page closing with its live channel.
