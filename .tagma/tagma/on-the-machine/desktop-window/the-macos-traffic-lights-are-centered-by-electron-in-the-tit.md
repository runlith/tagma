---
id: 01a1503c-e278-7c4f-b67b-19e8c4c7b819
title: The macOS traffic lights are centered by Electron in the titleBarOverlay strip, and the app header takes its height and left inset from it
ord: 18
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1503b-7bfa-7f58-a288-321715c313b7
sources:
  - kind: file
    ref: apps/tagma/app/src/app.css
  - kind: file
    ref: apps/tagma/desktop/src/projectWindows.ts
---
The window sets the strip height (`titleBarOverlay.height`); the page reads it as `env(titlebar-area-height)` in the `--topbar` token, and the button-zone width as `env(titlebar-area-x)` in the `titlebar-inset` utility. These values do not scale with the page: at ⌘−/⌘+ the header keeps the same physical height as the button strip. Fixed `trafficLightPosition` and `2.25rem` diverged at every zoom except 1.

Centering holds only while the buttons have no vertical position of their own: `trafficLightPosition` or `setWindowButtonPosition` with a `y`, and the `hiddenInset` style that insets itself (12, 11), pin the buttons to the top with that inset. Hence the `hidden` style, with the horizontal inset left to the system. In the browser and off macOS there is no overlay, and `env()` yields the fallback: 2.25rem and the ordinary `px-3` inset.
