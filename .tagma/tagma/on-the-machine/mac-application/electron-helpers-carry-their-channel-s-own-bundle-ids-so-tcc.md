---
id: 01a1b1ea-d63d-731d-9068-68f90870c6d1
title: Electron helpers carry their channel's own bundle ids, so TCC never mixes Tagma, Tagma Dev and other Electron apps
ord: 4
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1b1c8-21c2-7fd0-a938-a84e50821ad8
sources:
  - kind: file
    ref: apps/tagma/desktop/scripts/build-host.ts
---
`build-host` rewrites `CFBundleIdentifier` of the main bundle and the `.audio` and `.input` helpers, but the four Electron helpers keep the stock `com.github.Electron.helper` in Tagma, Tagma Dev and every unrenamed Electron app. The audio service lives in `Electron Helper.app`, so a microphone or camera grant and its reset are shared across channels and apps. Give each helper `<bundleId>.helper` (and its variants), check that signing and entitlements still hold, and narrow nothing else.