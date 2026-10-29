---
id: 01a1489c-3fa7-70a5-a41b-0a88761cf71f
title: "A desktop page always loads and stands in a hidden window: a never-loaded webContents does not answer the debugger, and an invisible one does not paint"
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/desktop/src/browser/placement.ts
  - kind: symbol
    ref: apps/tagma/desktop/src/browser/page.ts
    symbol: HeldPage
---
A webContents into which no document was ever loaded does not answer `Page.enable`, and the core would wait for it forever. So a new page always goes through `loadURL`, including `about:blank`, or through history restoration. `open` answers once that first navigation ends: it commits, fails, or stops loading without committing (a 204, a cancelled redirect). Until then the navigation is pending, and Chromium refuses debugger commands such as `Page.crash` against a pending navigation.

A page keeps its webContents from creation: a destroyed `WebContentsView`, which closing a popup's window makes, hands out no webContents, and placement still settles the page after that.

A page shown in no panel stands in a hidden `BrowserWindow` rather than hanging without a window: a `WebContentsView` without a window does not paint, and an agent's screenshot or stream would get an empty frame. While someone holds `paint`, the page's background throttling is lifted, and a hold counts as ready only after a non-empty `capturePage`: the first screenshot after showing may outrun the surface.

While the browser host runs, the process starts with `disable-backgrounding-occluded-windows`: a window occluded by other windows does not push its pages into the background. The price — Tagma's own windows also save nothing while occluded; an attempt to lift throttling on a page only for an agent session instead broke the next session after a deliberate renderer restart (the system scenario of element-picking after a hung page), so the process switch was chosen.

A popup lives in its own window with an origin bar, and that window is its home instead of the stand: `Placement` returns the view there with those bounds, otherwise the view would end up in two parents at once, and the next hold would give it the stand's bounds over the bar. Showing that window is the application's act (`HostActs.reveal`). The Electron test host keeps it hidden: a popup shown on the developer's screen takes their real clicks and wheel as the operator's input, and the engine then refuses the agent's acts on it as `operator-input`.

Eviction for memory takes only unshown pages with no agent and no hold: their history goes into the page record, and the page is raised again by the same `open`.
