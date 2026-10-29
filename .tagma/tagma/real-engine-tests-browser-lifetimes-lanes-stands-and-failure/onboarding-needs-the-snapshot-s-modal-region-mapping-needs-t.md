---
id: 01a1849f-a9e0-7e7b-80f2-9a5a49d87324
title: Onboarding needs the snapshot's modal region; mapping needs the view tree's frames
ord: 8
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/e2e/src/lanes/simulator.ts
  - kind: file
    ref: packages/e2e/src/lanes/template.ts
---
Safari's snapshot exposes a popover dismissal region that the native view-tree read can omit. Onboarding needs that modal boundary before tapping Close, while coordinate mapping needs the rendered WebView/content geometry.