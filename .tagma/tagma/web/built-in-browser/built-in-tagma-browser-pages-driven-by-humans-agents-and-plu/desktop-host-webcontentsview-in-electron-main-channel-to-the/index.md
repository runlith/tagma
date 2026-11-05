---
id: 01a147b0-e165-75df-b2b0-9a0e255c4582
title: "Desktop host: WebContentsView in Electron main, channel to the server over a socket, page policies, overlays, and keys"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a147e4-e266-7d95-ae42-070fbdb94d27
---
The desktop host keeps pages as `WebContentsView` in Electron main (`apps/tagma/desktop/src/browser/`, module [[2f69b0c4|desktop window]]) and serves the `PageHost` and `ProfileHost` ports of the [[39241ecf|browser module]]. On the server side the `desktop` adapter — its own module — forwards port calls over a channel; the channel wire lives in its `contract/wire`, which desktop imports, as it already imports the server wire.

**Channel to the server.** `/api/ws` is an Effect RPC socket: the client calls, the server answers or streams parts with ACK; each inbound request runs in its own fiber with no ordering across requests. So the channel is shaped as:
- **Server → host.** The module adapter's `attach_browser_host` feed: the caller is the operator, a call with a `deviceId` (attached device) refuses, so only this machine's process can attach. Main passes a permanent host id (over the desktop data directory) and its pid. Feed items are host-port calls, in batches, paced by part ACK.
- **Host → server.** Call answers, CDP events, and page-life events go in one stream, admitted once per connection generation, not one operation per batch. Each message carries `(host id, generation, seq)`; the adapter applies them strictly by `seq` and holds gaps; a gap that never fills is a broken channel. Which platform mechanism holds this stream — a client stream of the same socket or a separate route under the same admission — the performer decides by platform; the `seq` contract is the same.
- **CDP payload** travels as opaque text: main forwards `webContents.debugger` text with a bounded header (`id`, `method`, `sessionId`), the server never parses it on the event loop.
- **Breaks.** Unfinished calls get `outcome-unknown` with no silent retry; the host's pages become `away`. While the process with the reported pid lives, agent actions wait for its return; after reconnect the host reports live pages, the server reconciles them with records. Pages outlive server restarts.
- Main attaches to its data directory's server, like the window ([[d6920c21|window and server]]); the server never calls desktop. A window aimed at another machine's server registers no host.
- **Cost.** CDP events and broadcast frames travel the main event loop, which also drives window input. The performer measures window input lag (one sample) under two loads: 15 fps broadcast of a network-heavy page and an agent loop of full snapshots of a heavy page. If lag exceeds a frame and the viewer budget does not remove it, frames take a separate binary route under the same admission with the same `seq`. Measurement ([[93cb7437]], [[f168d3f7]]) left broadcast on the current route. Snapshots hit something else: main stands ~0.1 s per MB of CDP answer, almost all of it inside Electron — translating the `webContents.debugger` answer into a JS object before host code. The host's own copies (serializing, slicing, sending) are under a tenth. Decision: CDP stays in main via `webContents.debugger`. The remote-debugging port is rejected: it would open all webContents to any machine process — Tagma windows and the human's profiles with their logins. The debug pipe is set only at process launch, and a human launches the app. The desktop carries the cost where the engine that spawns it does: every answer is size-bounded, few commands per read. An answer in tens of megabytes (a full accessibility tree of a very large page) is a known seconds-long window input freeze.

**Page.**
- Each page is a `WebContentsView` with its own `webContents` in partition `persist:browser-<profile id>`. The name derives only from the profile id: at Orca a process-id name wiped cookies on every restart.
- `webPreferences`: `sandbox`, `contextIsolation`, no `nodeIntegration`, no preload. `webviewTag` stays off in windows.
- One owner sets the partition session hooks (`webRequest`, permission, download, certificate, `login` handlers) — desktop's `ProfileHost`: a session has one `webRequest` handler of each kind, and the next silently replaces the previous.
- Policies are set before first load:
  - navigation — `http`, `https`, `blob` over them, `about:blank`;
  - `window.open` with no name or features opens a new page; named or featured (OAuth) opens a registry page with its opener, which main shows in a popup window with an origin bar, taking a pre-created Electron `webContents` to keep `window.opener`;
  - a page with no user gesture opens at most four tabs per two seconds — Orca's number, which stops tab streams from a page without blocking clicked links;
  - permissions denied by default with a short list (fullscreen, clipboard write, pointer lock); microphone and camera by the human's decision on the origin in the window showing the page (an unshown page gets refusal; the decision lives until app exit), then via macOS request: for the camera the app and its helpers get `com.apple.device.camera` and `NSCameraUsageDescription` next to the already present microphone ones ([[5077d129|signing and entitlements]]); screen capture denied;
  - downloads go to the user's download folder, events into the page record;
  - certificate errors closed;
  - `alert` and `confirm` on an undriven page are shown by Electron's native handler: in 44.8.0 internal `-run-dialog` was observed, no public event about them. With an attached debugger CDP reports and answers them, but native dispatch is also called; the host reconciles it with CDP so no second native dialog is left. `prompt()` in Electron 44.8.0 throws `prompt() is not supported.` even with a debugger; the host does not promise it. `beforeunload` main catches via `will-prevent-unload`: Electron's callback resolves synchronously. Main first leaves the page open, reports the exit intent, and after the answer repeats the agreed close or navigation; the event is never stored as a CDP dialog awaiting an answer.
- `webContents` `unresponsive` and `responsive` become "not responding" and "responding again" events, but never serve as the sole detector: in the Electron 44.8.0 experiment an attached debugger left a hung renderer with no `unresponsive`. For a driven page the host keeps a separate lightweight request to the renderer outside the page command queue; its delay past threshold reports "not responding", the next answer "responding again". The threshold belongs to someone else's renderer; its own host channel is still waited on with no deadline. A crashed page process is a separate event, the panel offers reload.
- A hidden service `webContents` in the profile partition gives `ProfileHost.session` for importing and clearing cookies without touching human pages.
- Desktop exit and crashes make pages `away`; the next reconnect reconciles them to `dormant`.

**Showing in the panel.**
- The browser panel reports via the `tagmaDesktop.browser` bridge the page id, rectangle, and visibility. Main adds the view to the panel window and sets bounds; the rectangle updates on every layout change. The bridge reports its host id so the client decides whether to show the page natively.
- A view stands in one place at a time: showing a page in another panel — of the same window or another — moves it there, the old panel gets "shown elsewhere" with a "show here" action.
- A page no panel shows stands in a hidden parking window of the last viewport size. While the page holds a `paint` holder (main counts holders), it paints with no background throttling; a page whose window is minimized, hidden by fast hide, or covered by other windows moves to parking for that time. On macOS arm64 Electron 44.8.0 confirmed native capture, CDP screenshot, and screencast in a never-shown `BrowserWindow({show:false})`. Capture waits for a ready frame: right after load native capture can still answer `Current display surface not available for capture`. A window shown off-screen is no proven replacement: macOS clamped it into the visible area.
- When a window leaves the surface (waiting page, surface reload) or closes, main moves its views to parking; after return panels show them again. The move keeps `webContents` and the document. Closing a `BrowserWindow` never closes `WebContentsView` pages itself: main finalizes them explicitly, only when the pages themselves close.
- Unloading for memory: when live views exceed a share derived from machine memory, a long-unshown undriven page unloads — the host stores history (`navigationHistory`) in the record and closes the view; the server marks it `dormant`. Each view is a Chromium process.

**Overlays and dragging.**
- The native view lies above all window HTML, so palette, menu, dialogs, popovers, notifications, and the restart banner are invisible where they overlap the page rectangle.
- While an open layer intersects the page, the panel freezes the view: main makes `capturePage`, the panel paints that frame in place of the page, the view goes to parking; after the layer closes the view returns. The snapshot starts on the intent to open the layer (press, key), so the swap lands before it paints.
- Open layers have one owner — the kit layer stack ([[313c7343|layer stack]]). The host needs three things from it, missing from [[313c7343|its spec]] today: open-layer rectangles, notification-step rectangles, and a layer-open intent signal. They go into the stack spec, and the desktop host builds after it.
- The same freeze runs while dragging seams and panels: the native view grabs pointer events.

**Keys and focus.**
- Presses inside the page never reach renderer. App chords have one publishing owner — the keyboard-map service in renderer, which does not exist today: chords live in their components. The service hands the list to main via the bridge; main intercepts them in the page's `before-input-event` and forwards to its window's renderer, the page gets the rest.
- Main keeps its own chords — ⌘N (new window), F12 and ⌘⌥I (window DevTools) — and catches them in page views too. ⌘W and ⌘⇧T resolve by focus: with focus in the browser panel they close and return the page, otherwise the thread tabs' current command.
- Hiding a focused view returns focus to the window: otherwise macOS activates another app.
- Main builds the page context menu: copy, paste, open link in a new tab or in the system browser, save image, inspect element.
- Page search, zoom, and DevTools are bridge actions main runs on the `webContents`. Human navigation from the panel is server operations the host runs with `loadURL` and `webContents` history, no CDP. PDF printing is a `PageHost` action: main runs `webContents.printToPDF`, because `Page.printToPDF` is missing from Electron 44.8.0 CDP; screenshots stay via CDP.
- The bridge takes calls only from its own origin's surface, as it already takes view windows ([[2ecfcfcd|view windows]]).

**Identity.** Before `ready`, main sets `app.userAgentFallback` with no `Electron/x` tokens or app name: with stock Electron UA, Orca users were thrown out of x.com and LinkedIn. The process fallback exists for workers, which take the process identity; Tagma's own windows get the same UA, and it does not hinder them. On `accounts.google.com` and `accounts.youtube.com` the page presents as Firefox: Google binds the session to the identity used at sign-in. The "cleaned" vs "native" identity choice lives in desktop userData and is read at launch, before the server; the settings section switches it via the bridge, applied after app restart. Measurements and tradeoff are in the [[447be62e|study]].

**What the performer proves.**
- Channel and server `desktop` adapter integration test against a scripted fake host: registration, call refusal with `deviceId`, call and answer, ordering by `seq` on reordered messages, `outcome-unknown` and `away` on break, waiting on a live pid, reconnect and reconcile.
- System tests under real Electron from workspace (`*.stest.ts`) against its own `tagma:try` instance: engine scenarios (snapshot, click, input, screenshot, element picking) on a `WebContentsView` page; surface reload and instance restart leave the page alive at the same address, and the agent continues.

**What the operator checks.** Palette, menu, and notifications over the page; seam dragging; ⌘K, ⌘L, and ⌘W with focus in the page; sign-in to Google and GitHub; OAuth popup; camera and microphone on site.
