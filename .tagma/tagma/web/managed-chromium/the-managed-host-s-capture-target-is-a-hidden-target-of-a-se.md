---
id: 01a1700e-a5f3-7365-a21e-ec244549aa33
title: The managed host's capture target is a hidden target of a separate capture browser, present in neither profiles nor pages
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
`CaptureHost.target` on the `managed` host opens a hidden target (`Target.createTarget` with `hidden: true`) in a separate capture browser — its own Chromium process with its own data directory, not any profile's browser. So capture sees no profile cookies or storage, lands in neither page records nor the host's `live`, and its targets don't disturb agent tabs. A hidden target in headless=new paints: `requestAnimationFrame` runs, a 1920×1080 snapshot at DPR 0.5 — 960×540 — takes ~55 ms (one sample, Chrome for Testing 151, macOS arm64); an ordinary invisible target of the same browser served its first snapshot in ~8.8 s.

At startup the host keeps its own ordinary `about:blank` target until the process ends: Chromium allows `hidden: true` only while `RemoteDebuggingTargets(kFrame)` is non-empty, even with `--remote-debugging-pipe` running. After the starter tabs close the list can empty; built-in extension workers accidentally hide this defect while alive. The service target enters neither page records nor `live`, does not count as occupancy and closes with the browser. The condition is verified against [Chromium 151 TargetHandler](https://github.com/chromium/chromium/blob/151.0.7922.71/content/browser/devtools/protocol/target_handler.cc).

The capture browser takes Chrome for Testing, or — if its build or startup is unavailable — installed Google Chrome; the refusal names both causes and both exits. A completed startup leaves the in-progress map before its waiters resume, so a fallback starts a new attempt rather than inheriting the first attempt's failure. While a target lives the browser counts as busy and never idles out; 5 minutes after the last target it exits, like a profile browser. The desktop host does not implement capture (`capture: null`): clips and frames work without the app too.
