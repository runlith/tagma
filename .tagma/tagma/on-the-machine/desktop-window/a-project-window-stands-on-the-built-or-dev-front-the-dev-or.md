---
id: 01a17d4c-a23e-7df8-828e-94a259cc4b52
title: A project window stands on the built or dev front; the dev origin is trusted only while a window stands on it, and only a fact moves away from it
ord: 30
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a17d3f-1d04-7f62-bd64-5be6b724c701
sources:
  - kind: file
    ref: apps/tagma/desktop/src/fronts.ts
  - kind: file
    ref: apps/tagma/desktop/src/projectWindows.ts
---
A front is a property of a project window: built (the server address) or dev (the Vite address from the `start_dev_surface` reply). Other windows, view windows, and the pill stay on built, and a window's address is kept on the built origin, so return and the loader's `open` lead to the same path.

A dev origin is a localhost port that any machine process can take after Vite exits. So the bridge, IPC, navigation, and external links trust it only while at least one window stands on it (`Fronts`), and every dev-origin check goes through it, not through a saved address: otherwise a stranger process's page on that port would receive the bridge.

A failed dev-address load does not go to `SurfaceLoader`: it decides the server's fate and would show “failed to start” and raise the server for it. It returns the window to the built front. `ERR_ABORTED` does not count: the address change itself produces it, including the return.

A window counts as gone from dev only once navigation away has really begun (`did-start-navigation`): until then the trust, the badge, and `current()` = dev stand. A document with an unsaved edit (`beforeunload`) can cancel the departure, and without this the window would stay on the dev page with no badge and revoked trust. So on its own transition main asks the person “Leave this page?”; “Stay” keeps the window on its previous front.

A window leaves dev only on a fact: the main frame failed to load, the page's renderer died, the address stopped accepting connections (polled every 2 s with no reply deadline while a window stands on dev). A compile error, the Vite overlay, and a hang do not move the window away: an edit in progress or a breakpoint pause look the same. A refused connection moves all dev windows away once per stay: a window the person left on dev is no longer disturbed by polling. When the loader puts up the waiting page (server not up, someone else's address), it takes dev off every window, and after the rise the windows open on built; a server re-raised while windows stand on their pages does not touch the windows, same as built ones. The choice is never stored.

The option exists only in a build with no release number opened at no given address: a release composition has no operation, and a window at a given address already stands on the chosen origin.
