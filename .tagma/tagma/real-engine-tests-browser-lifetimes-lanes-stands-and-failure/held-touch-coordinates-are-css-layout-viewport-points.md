---
id: 01a1848d-aaff-7978-a210-3ca02a9cae2a
title: Held touch coordinates are CSS layout-viewport points
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/e2e/src/engines.ts
  - kind: file
    ref: packages/e2e/src/lanes/ios.ts
  - kind: file
    ref: packages/e2e/src/touch.ts
---
The shared contact uses page coordinates so one driver can serve Chromium and MobileSafari. Native atomic tap/swipe operations still take Simulator display points; mixing the spaces places input under Safari's chrome. The iOS contact adapter owns conversion, while callers of atomic native input can convert DOM geometry with pagePoint.

The conversion is resolved once when a contact presses and holds until it releases. On iOS that resolution is a native accessibility read lasting hundreds of milliseconds. Repeated for every sample, it left the finger still between samples long enough for iOS long-press and text selection to claim the touch, so a held drag never panned. While a finger is down, the WebView frame and visual viewport cannot change under it.