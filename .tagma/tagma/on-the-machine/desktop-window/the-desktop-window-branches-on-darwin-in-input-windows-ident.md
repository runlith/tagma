---
id: 01a1a76d-60ee-73c2-81a2-9608ed69b42f
title: The desktop window branches on darwin in input, windows, identity, permissions and reports
ord: 43
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0eaa1-2c4c-7cbd-9014-d7496f758080
  - kind: relates
    to: 01a19ec6-f467-787a-a87e-89cb77c57d56
sources:
  - kind: file
    ref: apps/tagma/desktop/src/instance.ts
  - kind: file
    ref: apps/tagma/desktop/src/swipe.ts
  - kind: file
    ref: apps/tagma/desktop/src/declared.ts
  - kind: file
    ref: apps/tagma/desktop/src/declaring.ts
  - kind: file
    ref: apps/tagma/desktop/src/tabKeys.ts
  - kind: file
    ref: apps/tagma/desktop/src/projectWindows.ts
  - kind: file
    ref: apps/tagma/desktop/src/main.ts
  - kind: file
    ref: apps/tagma/desktop/src/release.ts
  - kind: file
    ref: apps/tagma/desktop/src/report.ts
  - kind: file
    ref: apps/tagma/desktop/src/browser/host.ts
  - kind: file
    ref: apps/tagma/desktop/src/browser/identity.ts
  - kind: file
    ref: apps/tagma/desktop/src/browser/profiles.ts
---
The window is Electron, which runs on three operating systems, but its main-process code is written for macOS with other platforms as the fallback. Each branch reads `process.platform` or calls an Apple tool directly, so no contract stands between the window and its macOS parts. `preload.ts:38,135` maps the platform to the `OperatingSystemKind` it hands the surface; that is a fact delivered through the bridge contract and is fine.

Read at ee24295b8e:
- `instance.ts:10` the single-instance lock uses macOS `O_EXLOCK` and trusts the election elsewhere.
- `swipe.ts:23` the AppKit swipe addon loads only on darwin.
- `declared.ts:5` and `declaring.ts:83` process creation-time precision is 10 ms on darwin and 1000 ms elsewhere.
- `tabKeys.ts:16`, `browser/host.ts:688`, `projectWindows.ts:375` the command-key chords read `process.platform === 'darwin'`.
- `projectWindows.ts:170` the hidden title bar and overlay are applied on darwin.
- `main.ts:427` the app quits on window-all-closed except on darwin.
- `browser/identity.ts:39-42` the Firefox user agent platform by OS (the same table as `managed-browser/builds/chrome.ts`).
- `browser/profiles.ts:49` system media access is asked only on darwin.
- `release.ts:24` the lease helper `dlopen`s `libc.dylib` for `flock`.
- `report.ts:56,74` `/usr/bin/sw_vers`, `/usr/sbin/sysctl hw.model` and `/usr/bin/ditto`, and the report text says `macOS`.

Unclear:
- `scripts/build-host.ts:94,100,222,226` and `scripts/dev.ts:62` build and sign the macOS bundle and branch on darwin around it. They are the package's own build scripts, but they are not separated into a macOS build.

Done when each macOS behaviour sits behind a window-platform contract the desktop declares and a macOS adapter fills, the window code names no OS, and the window's OS-independent tests pass on a Linux runner.