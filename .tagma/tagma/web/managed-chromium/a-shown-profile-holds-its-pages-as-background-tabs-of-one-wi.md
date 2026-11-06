---
id: 01a1a857-874e-7994-995e-c1ea9b58e594
title: A shown profile holds its pages as background tabs of one window it never raises, and they paint while the engine drives them
ord: 17
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/managed-browser/builds/chrome.ts
    symbol: chromeArgs
  - kind: symbol
    ref: apps/tagma/server/src/managed-browser/targets.ts
    symbol: pageTarget
---
A shown profile's browser starts with `--no-startup-window`, and the host creates no target of its own in it, so the first `open_page` after a launch opens the profile's window and that window holds only pages. Every page is created with `background: true` and no `newWindow`: Chrome puts it as a background tab into the profile's most recently active window, or opens a new window shown inactive when none is left — the operator closed it, or Tagma closed its last page ([Chrome's TargetHandler::CreateTarget](https://github.com/chromium/chromium/blob/151.0.7922.71/chrome/browser/devtools/protocol/target_handler.cc)). One window instead of one per page keeps an agent working through several pages from flooding the operator's screen; the profile's isolation is its own data directory, which tabs share as windows did. A background tab leaves the tab the operator chose in front.

No page is ever activated, and nothing raises Chrome: `Target.activateTarget` and `Page.bringToFront` end in `Browser::ActivateContents`, which activates the window. Measured on Google Chrome 157, macOS 26, with the frontmost app read by pid (one sample): the launch, the first window, a later background tab and a window reopened after the last page closed each left another app in front.

A background tab is hidden: no animation frame, no screencast frame (measured: 0 frames in 2 s on an animating page; `Page.captureScreenshot` still answers, by its own hidden capturer hold). It paints while the engine holds a session on it, because the engine turns on `Emulation.setFocusEmulationEnabled`, which in Chromium takes a visible capturer hold on the page ([EmulationHandler](https://github.com/chromium/chromium/blob/151.0.7922.71/content/browser/devtools/protocol/emulation_handler.cc)): measured `visibilityState` visible, animation frames running and 191 screencast frames in 2 s on the same background tab. Everything Tagma does with a page goes through an engine session, so the managed host's `paint` needs no hold of its own; the headed lane of `host.e2e.ts` drives a background tab through a frame wait, `wait_for_page`, the screencast, `snapshot_page`, `act_on_page`, `capture_page` and navigation.

With `--no-startup-window` and the debugging pipe Chrome holds a `REMOTE_DEBUGGING` keep-alive on every desktop OS ([ChromeDevToolsManagerDelegate](https://github.com/chromium/chromium/blob/main/chrome/browser/devtools/chrome_devtools_manager_delegate.cc)), so the browser outlives its last window and ends only by `Browser.close` — at idle, or when the server stops.

Window placement is Chrome's own: it saves the placement of the last tabbed window resized or closed and gives it to the first window of the next launch. That the first window of a launch started with `--no-startup-window` takes the saved placement is read from Chrome's design, not measured.

A profile session needs a frame target for `hidden: true`: with a page open it is hidden; with none it opens its `about:blank` the way a page opens — a background tab of the window, or an inactive window when none stands — for its own duration.

Rejected: a hidden own target. With only a hidden target alive and no window open, `Target.createTarget` gave no answer for 10 s (Google Chrome 156, macOS, one sample); the same state still follows when the user closes the last window while a profile session is held. A minimized own window still stands in the Dock and in the window list.
