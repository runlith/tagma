---
id: 01a1845c-e541-7522-be69-64776febfab1
title: The shared engine scenarios run against the desktop host under real Electron
ord: 6
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a147b0-e165-75df-b2b0-9a0e255c4582
---
The spec's performer proof requires the engine scenarios (`browser/testing/scenarios.ts`: snapshot, click, input, screenshot, element picking, crash and frame-hang recovery) to pass on a `WebContentsView` page, but only `managed-browser/engine.itest.ts` calls them; no desktop suite exists, so every desktop-specific path — including the discard reload added for hung out-of-process frames — is proven by code reading alone. Add the desktop caller over the existing Electron test host (`desktop-browser/testing/electron.ts`). It launches Electron, so it waits on the operator's word on live checks for this work.