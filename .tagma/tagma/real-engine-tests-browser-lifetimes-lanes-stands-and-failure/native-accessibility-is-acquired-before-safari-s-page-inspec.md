---
id: 01a18423-5f68-7975-91a2-d6f2c84fee68
title: Native accessibility is acquired before Safari's page inspector
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/e2e/src/lanes/ios.ts
  - kind: file
    ref: packages/e2e/src/lanes/simulator.ts
  - kind: file
    ref: packages/e2e/src/lanes/template.ts
---
A clone needs its own automation session; the template's running app and accessibility mode are preparation state. App launch takes the native companion's PID receipt before the separate UI-quiescence read. Acquisition order keeps the native accessibility server available before page inspection. Onboarding explicitly addresses Safari's launch PID and the known system UI process that owns its blocking search-preference alert; page selection and native geometry bind to Safari's PID. Simulator boot completion does not guarantee that the window server can name a frontmost application, and that lookup cannot establish which Safari page owns coordinate conversion.