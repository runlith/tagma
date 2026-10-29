---
id: 01a17d4c-a2e2-7159-ad00-10d7d02e59c3
title: The dev-front badge is drawn by main in a WebContentsView of its own session so exiting survives any dev-page breakage
ord: 31
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a17d3f-1d04-7f62-bd64-5be6b724c701
sources:
  - kind: file
    ref: apps/tagma/desktop/src/devSurface.ts
---
Leaving the dev front must not depend on the dev page: the card row and the bridge member live in it and disappear with a white screen, an exception, a crashed or hung renderer, while the person may not find the View menu item. So while the window is on dev, a separate `WebContentsView` stands over the page with a page drawn by main (data: URL, the “Built” action via `will-navigate`, as on the waiting page).

Its own partition gives it a different browser context, hence a different renderer process: in a shared session Chromium could seat it in the dev page's process, and its hang or crash would carry the badge away too. JavaScript on the badge page is off: it only needs a link. The badge stands in the middle of the status row, usually empty in the app, and shows the Vite address so a dev-front breakage is not confused with a product breakage.
