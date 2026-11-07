---
id: 01a1a7b9-e270-7d5a-94b9-1eeb2a7edd30
title: CI test lanes share sharding and timings; native desktop checks remain manual
ord: 21
tags: ["explanation"]
sources:
  - kind: dir
    ref: .github/workflows
---
The reusable workflow owns the timing baseline and shard reports for each lane. Unit and Linux integration run on every push to main that touches more than the graph, one run per lane at a time with the newest push replacing a waiting one, so a breaking commit is named by the run it lands in; every lane, the macOS runner and the e2e lanes are also dispatched by hand. Integration on a macOS runner sets `TESTBED_PLATFORM_ONLY`, so it runs only the files marked `.darwin.` on two shards: every shared file already runs on Linux on each push, and macOS runners are few. Headless e2e runs Chromium, WebKit and Electron on Linux; MobileSafari runs separately on macOS with its own package script and lane filter, so neither platform initializes the other's fixtures. The native holder and platform crates' tests (`test:native`) are a one-shard lane of the integration workflow, dispatched per runner. Chrome for Testing publishes no linux-arm64 build, so an arm64 Linux runner skips its fetch: a package without engine tests runs there whole, and an engine test fails naming the missing build. Window-behavior checks require an interactive desktop and existing Accessibility grants and therefore remain manual.