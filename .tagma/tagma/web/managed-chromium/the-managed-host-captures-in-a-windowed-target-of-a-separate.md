---
id: 01a1700e-a5f3-7365-a21e-ec244549aa33
title: The managed host captures in a windowed target of a separate capture browser, present in neither profiles nor pages
ord: 7
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/browser/contract/service/hosts.ts
    symbol: CaptureHost
  - kind: symbol
    ref: apps/tagma/server/src/managed-browser/host.ts
    symbol: makeManagedHost
  - kind: symbol
    ref: apps/tagma/server/src/managed-browser/targets.ts
    symbol: captureHost
---
`CaptureHost.target` on the `managed` host opens a target in a new window (`Target.createTarget` with `newWindow: true`) of a separate headless capture browser — its own Chromium process with its own data directory, not any profile's browser. So capture sees no profile cookies or storage, lands in neither page records nor the host's `live` (the host adopts only targets with an opener), and its targets don't disturb agent tabs.

Capture never uses a `hidden: true` target: Chromium's [hidden target manager](https://github.com/chromium/chromium/blob/151.0.7922.71/content/browser/devtools/protocol/hidden_target_manager.cc) creates a bare WebContents parented to no window. On Aura platforms — Linux among them — a view draws through its window's compositor, so such a document loads and seeks but never receives an animation frame, and the paint wait hangs. That this differs on macOS, where capture into a hidden target passed, is inference from per-view compositors there. A profile session (`profiles.session`) still opens a hidden target: it reads storage and never paints.

At startup a hidden browser — a hidden profile's or the capture browser — keeps an ordinary `about:blank` target of the host's own until the process ends: Chromium allows `hidden: true` only while `RemoteDebuggingTargets(kFrame)` is non-empty, even with `--remote-debugging-pipe` running. After the starter tabs close the list can empty; built-in extension workers accidentally hide this defect while alive. The service target enters neither page records nor `live`, does not count as occupancy and closes with the browser. The condition is verified against [Chromium 151 TargetHandler](https://github.com/chromium/chromium/blob/151.0.7922.71/content/browser/devtools/protocol/target_handler.cc).

The capture browser takes Chrome for Testing, or — if its build or startup is unavailable — installed Google Chrome; the refusal names both causes and both exits. A completed startup leaves the in-progress map before its waiters resume, so a fallback starts a new attempt rather than inheriting the first attempt's failure. While a target lives the browser counts as busy and never idles out; 5 minutes after the last target it exits, like a profile browser. The desktop host does not implement capture (`capture: null`): clips and frames work without the app too.
