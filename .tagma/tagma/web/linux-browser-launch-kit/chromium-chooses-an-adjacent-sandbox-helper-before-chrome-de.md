---
id: 01a1a866-f13b-7540-88a1-33f980ceadae
title: Chromium chooses an adjacent sandbox helper before CHROME_DEVEL_SANDBOX
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/chrome-for-testing/src/launch/linux/platform.ts
---
The pinned Chromium builds take an existing executable-adjacent `chrome-sandbox` before the environment helper; the variable cannot repair an invalid adjacent file. Electron ships that adjacent helper, while the managed Chrome for Testing distribution uses the environment path. Setup therefore configures the adjacent helper where one is shipped and supplies a correctly installed environment helper for the managed build, without disabling sandboxing. The Linux refusal keeps that distinction actionable. This selection is visible in [Chromium 151's helper owner](https://raw.githubusercontent.com/chromium/chromium/151.0.7922.71/sandbox/linux/suid/client/setuid_sandbox_host.cc).