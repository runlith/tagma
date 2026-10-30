---
id: 01a0c837-9827-7c2d-883f-43638dbced57
title: List every origin the surface is served from in appOrigins when calling installExternalLinks
ord: 8
tags: ["rule"]
sources:
  - kind: file
    ref: packages/desktop-host/src/ExternalLinks.ts
  - kind: symbol
    ref: packages/desktop-host/src/ExternalLinks.ts
    symbol: installExternalLinks
---
Navigation to an origin missing from the list is cancelled and opened in the system browser instead of the window.