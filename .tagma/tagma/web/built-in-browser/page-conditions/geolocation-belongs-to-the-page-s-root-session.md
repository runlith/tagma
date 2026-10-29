---
id: 01a18503-d133-753c-b519-314551307a26
title: Geolocation belongs to the page's root session
ord: 2
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a184dc-4fbe-7b01-a2d5-4fa84aecb62a
sources:
  - kind: symbol
    ref: apps/tagma/server/src/browser/engine/emulate.ts
    symbol: applyConditions
---
Chromium keeps the position override on the WebContents shared by the root and its out-of-process frames. A child session that sets it also clears it when that session detaches, erasing the root's position. Only the root session therefore sets or clears geolocation; removal uses the clear command, because setting no coordinates installs a position-unavailable error instead.