---
id: 01a1923e-2a3e-77f8-a9d1-e96cb02a2de0
title: Hidden built-in browser pages rest, and a link opening a new tab shows it beside its opener
ord: 51
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a1489c-3fa7-70a5-a41b-0a88761cf71f
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-0462886d0b63
sources:
  - kind: file
    ref: apps/tagma/desktop/src/browser/placement.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/OpenPages.svelte.ts
---
**Problem.** Measured on 2026-10-31 on a 12-core Mac with 32 GB (one sample). The operator clicked about ten `target=_blank` links in a page he had opened himself. This created ten live pages that no panel showed. Five page renderers each took 7–64 % of a core. Electron's single GPU process took about 93 % of a core, and the system video decoder ran for it. Tagma's own window, which draws through the same GPU process, dropped to a few frames a second while 4–5 cores stayed idle. Closing the ten pages took the machine from about 60 % to 17 % busy.

**Roots.**
1. A page opened by another page gets a tab only when a thread started its chain: `OpenPages.opened` returns when `openedBy` is null. So a link the operator clicks in his own page creates a page that no tab shows.
2. A desktop page that no panel shows runs at full speed. It stands on the hidden stand, and the process switch `disable-backgrounding-occluded-windows`, which agent captures need, keeps Chromium from backgrounding it. Measured with Electron 44.8: a page on the stand draws 60–120 animation frames a second and runs a 10 ms timer 100 times a second.

**What will be.**

*A new tab stands beside its opener.*
- **Placement.** A page that another page opens as a tab becomes a right-area tab right after the opener's tab, in every window that shows the opener's tab, including another project's screen where that tab stands as a portable page. Such a tab comes from `target=_blank`, from `window.open` without window features, or from "Open link in new tab".
- **Activation.** A foreground tab (a plain click) activates only when the opener's tab is the active one and the area is shown. A background tab (⌘-click, middle click or the context menu) never activates.
- **Agent-driven opener.** When an agent drives the opener, the new tab opens in the background with the agent mark, so it never steals focus.
- **Opener tab shown nowhere.** If a thread started the chain, the page goes to that thread's layout quietly, as today. An operator page whose opener no window shows gets no tab: it rests under *A page nobody sees rests* below and stays listed in the address-bar suggestions.
- **Named popups.** A named popup keeps its own window, which main shows.

How each layer carries it:
- **Desktop host.** Its `opened` event carries `disposition`: `tab`, `background-tab` or `window`, taken from Electron's open disposition. The field is optional on the wire, so a desktop host of an older build that outlives a server update keeps its channel; its pages simply get no beside-placement.
- **Managed host.** It reports `tab`, because CDP's `Target.targetCreated` carries no disposition.
- **Server.** The `put` that announces a page adopted from an `opened` event carries the same `disposition`. A page adopted while reconciling a returning host carries none.
- **Client.** `OpenPages` places the page beside its opener in this window's `SidePanes` when that window shows the opener's tab. Otherwise it calls `ThreadPlaces.openFor` with the opening thread, as now.

*A page nobody sees rests.*
- **Awake.** A desktop page is awake only while at least one of these holds:
  - it stands in a panel of a visible window;
  - its popup window is visible;
  - an engine session drives it, whether an agent, a remote viewer or element picking;
  - a paint hold stands on it.
- **Frozen panels.** A panel frozen under an overlay or a window drag still counts as shown: the operator sees its still in place. Resting it would flip the page's visibility on every menu, popover and drag, and its cost stays that of the one page in view.
- **At rest.** Otherwise `Placement` hides its view with `WebContentsView.setVisible(false)`. Chromium then treats it as a background tab: no painting, no animation frames, timers at Chromium's background rate and background video paused.
- **Waking.** Waking shows the view again.
- **Process switch.** The switch stays. Without it a page held on the hidden stand draws one frame a second, and after a renderer restart it captures nothing. That is the failure recorded in [[761cf71f]].
- **Measured.** One sample of this design on Electron 44.8, macOS arm64:
  - at rest the page draws 0 frames, ticks its timer once a second and reports `visibilityState` as hidden, and it stays at rest across a renderer restart;
  - a paint hold wakes it with capture ready at once and full frame rate within 3 s, and releasing the hold returns it to rest.

**Rejected.**
- **Unloading hidden desktop pages after idle time.** Rest already takes their CPU to near zero, and the page-count limit already bounds their memory. Unloading would add only the loss of unsaved form state.
- **Dropping the process switch.** The measurement above shows it breaks held capture after a renderer restart and the frame rate on the stand.
- **Freezing through CDP `Page.setWebLifecycleState`.** It needs a debugger on every human page, and the browser keeps human pages without one: an attached debugger is a bot signal to Cloudflare.

**Limits.**
- The Electron e2e lane cannot observe rest: under its Playwright attachment every `webContents` reports `isBeingCaptured()`, even with trace screenshots off, and Chromium keeps a captured page visible. Which Playwright call does it was not established. The rest test is therefore an integration test.
- A page shown in a Tagma window that is on screen but covered by other windows stays awake. The process switch keeps occluded windows unbackgrounded, and Electron reports no occlusion.
- The managed host cannot tell a background tab from a foreground one, so it opens every new tab in the foreground.
- The managed host's pages are outside this spec: they unload 15 minutes after their last engine session ([[088225c2]]).

**Acceptance.**
1. A desktop Electron integration test, driving `BrowserHost` through its calls and waiting on the page's own visibility events, passes all of these:
   - a page on the stand with no hold and no session reports `hidden`, which in Chromium means no animation frames;
   - a paint hold makes it visible, and an animation frame arrives;
   - releasing the hold returns it to rest;
   - a renderer restart at rest leaves it at rest;
   - an engine session wakes it.
2. An app test of `OpenPages` passes all of these:
   - a `tab` opened from the active, shown opener lands right after the opener and activates;
   - a `background-tab` lands after it without activating;
   - an agent-driven opener puts it in the background with the agent mark;
   - an opener that this window does not show, with an opening thread, puts it in that thread's layout;
   - an operator opener that this window does not show gives no tab;
   - an opener standing on another project's screen gets its child beside it there.
3. The server's `put` for a page adopted from a host `opened` event carries its `disposition`.
4. The desktop engine scenarios in `apps/tagma/server/src/desktop-browser/*.itest.ts` pass.
5. [[761cf71f]] and [[886d0b63]] state the new behaviour.
