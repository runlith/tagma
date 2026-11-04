---
id: 01a185bb-ac17-714c-b0df-a3b743dc8ed1
title: iOS page values travel over a page WebSocket channel as JSON-only data, not through Web Inspector
ord: 11
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/e2e/src/lanes/inspector.ts
  - kind: file
    ref: packages/e2e/src/lanes/ios.ts
---
Web Inspector answers no evaluation while a native pan runs, so a test reading the page during a held touch would stall until the finger lifts. A bootstrap script installed through Web Inspector into every document of the selected page opens a WebSocket to a host server and evaluates what the host sends; navigation and the scroll recorder still go through Web Inspector, which is idle then. A full navigation retires the departing document’s channel before replacing the page; an early page failure must not request artifacts through a socket whose document cannot return. The page copies a value as plain JSON data and refuses anything JSON would change silently — non-finite numbers, `-0`, cycles, accessors, non-plain objects, symbol keys, array holes or extra array properties — as `UntransferableValue`, so a decoded value is the page's value and never a lossy stringification.