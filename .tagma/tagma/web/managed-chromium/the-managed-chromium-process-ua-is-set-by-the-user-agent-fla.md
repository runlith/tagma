---
id: 01a1488e-008b-71de-8977-7a3b8190e0b4
title: The managed Chromium process UA is set by the `--user-agent` flag, not by overriding on each target
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/managed-browser/builds/chrome.ts
---
Headless=new differs from windowed Chrome only by the `HeadlessChrome/<major>` UA token: client-hint brands — low- and high-entropy alike — are the same (measured 2026-10-17 on Chrome for Testing 151 and Google Chrome 155, macOS arm64, one sample). The flag replaces the token process-wide: in documents, out-of-process frames, dedicated, shared and service workers, and in their requests.

Rejected: `Emulation.setUserAgentOverride` with metadata on each target via auto-attach — `Network.setUserAgentOverride` does not change a shared worker's `navigator.userAgent`, and the debugger wait at target start holds service worker registration, hanging the page that registers it.

Only a `hidden` profile carries the flag: a `shown` one runs windowed Chrome, whose own UA has no `HeadlessChrome` and whose high-entropy hints stay filled.

The flag's price is empty high-entropy client hints (full version list, platform version, architecture), like any Chrome started with `--user-agent`. Platform strings are frozen reduced-UA values; major comes from the build release: a constant for Chrome for Testing, `--version` for installed Chrome, on Windows the version directory name next to `chrome.exe`. The identity system test only catches `HeadlessChrome`; if Chrome changes the reduced-UA format the test stays green while the UA drifts from windowed.
