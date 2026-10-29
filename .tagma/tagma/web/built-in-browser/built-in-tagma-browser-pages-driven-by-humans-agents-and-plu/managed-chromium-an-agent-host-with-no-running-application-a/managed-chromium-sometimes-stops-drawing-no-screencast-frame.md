---
id: 01a148b4-4563-729e-af00-f342cd4084d5
title: "Managed Chromium sometimes stops drawing: no screencast frames and no capture_page until the profile process restarts"
ord: 4
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a147d6-7ef4-7c9c-9e39-feae8df087e4
sources:
  - kind: file
    ref: apps/tagma/server/src/managed-browser/host.ts
---
Observation of 2026-10-17 on my own tagma:try instance (macOS 26.0.1, Apple M2 Max, Chrome for Testing 151.0.7922.71, `managed-agent` profile), twice in an hour. The server-launched profile process stopped drawing: `browser.screencast` hands the viewer over with not a single frame (the fallback screenshot after a second never arrives either), `capture_page` hangs 20 s on a new page, while `evaluate_in_page` works. Killing the profile process cures it: the next launch draws. Both times the page had just been watched by PageView from a second headless Chrome (the view-check script), with input and the page closed under the viewer. It never reproduced without that script: four rounds of "watch → input → close the page under the viewer → snapshot" passed.

The cause is unknown. The place to start is what Chromium does when a target closes mid-screencast and when `deviceScaleFactor` changes under it.

Done when the cause is named and fixed at its owner, or when a reliable repeat proves it is a Chromium defect the host works around.

**Checked 2026-10-17, did not repeat** (CfT 151 and Chrome 155, macOS 26.0.1, M2 Max; code after `e9d905d8b4`):
- Bare CDP with no Tagma, 80 rounds: screencast flow with and without ACK, 1–6 `setDeviceMetricsOverride` changes (DSF 1–3, mobile), `insertText`, flow restart, `clearDeviceMetricsOverride`, target close mid-flow. After every round a new page's snapshot passes.
- Background tabs. Headless=new keeps `Target.createTarget` targets as tabs of one window. Only the active one is visible: a background one has no frames, and `captureScreenshot` sometimes hangs. But `Emulation.setFocusEmulationEnabled`, which drive sets on each of its sessions, keeps the tab visible. A page with an engine session — and therefore under a viewer or on `capture_page` — never hides. So that was not the cause: `newWindow`/`bringToFront` was tried and rolled back (`7a75fa5f47`).
- The whole stack on tagma:try, 50 rounds: a viewer with layout, area changes with DSF 1–3, input, closing the page under the viewer and breaking the subscription in both orders, agent emulation to 4000×4000 at DSF 4. A new page's snapshot after each round takes 120–500 ms.
- The original view-check script (a second headless Chrome with the web client and `PageView`, desktop and phone, input), 6 runs in a row: click, input, and snapshot passed after each.

Both cases hit code where the viewer layout set DSF 2. It now sets 1. What stays unchecked is a hung Chromium GPU process. It fits that every page failed, including new ones, `evaluate` worked, and a fresh process cured it. But there is no repeat. On the next occurrence — before killing the process — take `SystemInfo.getInfo` and the Chromium process list (is the GPU process alive) plus `capture_page` on a new page.
