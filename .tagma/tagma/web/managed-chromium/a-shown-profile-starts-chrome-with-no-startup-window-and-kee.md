---
id: 01a1a857-874e-7994-995e-c1ea9b58e594
title: A shown profile starts Chrome with no startup window and keeps no window of its own, so every window holds a page and Chrome keeps the placement
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
A shown profile's browser starts with `--no-startup-window`, and the host creates no target of its own in it, so the first `open_page` after a launch opens the first window and every window on screen holds a page (measured on Google Chrome, macOS, by the headed lane of `host.e2e.ts`: one window for one page, two for two, no `about:blank` target). A target of the host's own in a shown browser is a window: kept from launch to exit, as hidden profiles keep theirs, it stood empty on `about:blank` beside the pages of every launch.

With `--no-startup-window` and the debugging pipe Chrome holds a `REMOTE_DEBUGGING` keep-alive on every desktop OS ([ChromeDevToolsManagerDelegate](https://github.com/chromium/chromium/blob/main/chrome/browser/devtools/chrome_devtools_manager_delegate.cc)), so the browser outlives its last page window and ends only by `Browser.close` — at idle, or when the server stops.

Window placement is Chrome's own: it saves the placement of the last tabbed window resized or closed and gives it to the first window of the next launch, and a new window within a launch takes the size of the window last resized. With no window of the host's own, that window is always a page. That the first window of a launch started with `--no-startup-window` takes the saved placement is read from Chrome's design, not measured.

A profile session needs a frame target for `hidden: true`: with a page open it is hidden, with none it holds a background `about:blank` window for its own duration.

Rejected: a hidden own target. With only a hidden target alive and no window open, `Target.createTarget` gave no answer for 10 s (Google Chrome 156, macOS, one sample); the same state still follows when the user closes the last page window while a profile session is held. A minimized own window still stands in the Dock and in the window list.
