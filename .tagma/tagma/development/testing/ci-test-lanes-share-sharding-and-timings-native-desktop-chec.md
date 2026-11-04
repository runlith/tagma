---
id: 01a1a7b9-e270-7d5a-94b9-1eeb2a7edd30
title: CI test lanes share sharding and timings; native desktop checks remain manual
ord: 21
tags: ["explanation"]
sources:
  - kind: dir
    ref: .github/workflows
---
The reusable workflow owns the timing baseline and shard reports for each independently dispatched lane. Headless e2e runs Chromium, WebKit and Electron on Linux; MobileSafari runs separately on macOS with its own package script and lane filter, so neither platform initializes the other's fixtures. The native holder and platform crates' tests (`test:native`) are a one-shard lane of the integration workflow, dispatched per runner. Window-behavior checks require an interactive desktop and existing Accessibility grants and therefore remain manual.