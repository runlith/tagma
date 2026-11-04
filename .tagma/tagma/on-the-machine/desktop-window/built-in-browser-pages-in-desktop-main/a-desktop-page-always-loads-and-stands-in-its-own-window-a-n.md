---
id: 01a1489c-3fa7-70a5-a41b-0a88761cf71f
title: "A desktop page always loads and stands in its own window: a never-loaded webContents does not answer the debugger, and an unwindowed one does not paint"
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

A page shown in no panel stands in a hidden `BrowserWindow` rather than hanging without a window: a `WebContentsView` without a window does not paint, and an agent's screenshot or stream would get an empty frame. A hold counts as ready only after a non-empty `capturePage`: the first screenshot after waking may outrun the surface.

Only on macOS does a never-shown window paint. On Linux (Electron 44.8 under Xvfb, measured in CI) a page parked in it draws its first frame and then none — 0 animation frames in 2 s against 101 once the window is mapped — so a reveal's paint request, a scrolled click and an LCP wait never answer; a restart scenario whose two ref clicks once both went missing is, by inference, the same stall leaving the browser stale hit-test data. Elsewhere than macOS the stand is therefore mapped with `showInactive` while its page is awake, moved beyond the right and bottom edges of every display each time it maps and whenever displays change, and hidden again when the page rests or leaves it. An engine session that maps a stand answers only once its page captures a non-empty frame there: a click sent into the freshly mapped window before its first frame went missing on Linux, by inference for want of the hit-test data that frame carries. A popup stays in its own window, which the application shows at once; one the operator hid or minimized gets no frames outside macOS while an agent drives it — moving its view onto a stand for that time made Electron throw on a view the closing popup had already destroyed, and was withdrawn. Windows was not measured; a third-party report of hidden Electron windows not painting there is why it takes the mapped stand too. A window manager that forces windows onto the screen would show the stand; none was tried.

A page is awake only while it stands in a panel of a visible window (frozen under an overlay included: its still is what the operator sees), its popup window is visible, an engine session drives it, or someone holds `paint`. Otherwise `Placement.settle` hides its view and restores its background throttling, and Chromium runs it as a background tab: no painting, no animation frames, timers at the background rate. Waking does the opposite, and both go through `settle` alone. Throttling is part of waking because on the hidden stand a shown view with throttling on still reads as hidden. Without rest, every page the operator left behind, including tabs no panel shows, drew 60–120 frames a second through the GPU process that also draws Tagma's own window. Measured on Electron 44.8, macOS arm64, one sample: at rest a page draws 0 frames and stays at rest across a renderer restart; a hold wakes it with capture ready at once and full frame rate within 3 s.

While the browser host runs, the process starts with `disable-backgrounding-occluded-windows`. Without it, a page woken on the hidden stand draws about one frame a second, and after a renderer restart it captures nothing — the next agent session after element-picking recovers a hung page broke this way. The price: a Tagma window that is on screen but covered keeps its shown pages and itself awake, because Electron reports no occlusion.

A popup lives in its own window with an origin bar, and that window is its home instead of the stand: `Placement` returns the view there with those bounds, otherwise the view would end up in two parents at once, and the next hold would give it the stand's bounds over the bar. Showing that window is the application's act (`HostActs.reveal`). The Electron test host keeps it hidden: a popup shown on the developer's screen takes their real clicks and wheel as the operator's input, and the engine then refuses the agent's acts on it as `operator-input`.

Eviction for memory takes only unshown pages with no agent and no hold: their history goes into the page record, and the page is raised again by the same `open`.
