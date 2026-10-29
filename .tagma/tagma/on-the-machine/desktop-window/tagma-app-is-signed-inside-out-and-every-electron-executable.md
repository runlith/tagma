---
id: 01a10492-c297-723e-a543-e2015077d129
title: Tagma.app is signed inside out, and every Electron executable's entitlements are named explicitly; which of them were measured is stated at each
ord: 1
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1047e-ddf0-7edd-b8da-e671479a7f7a
sources:
  - kind: file
    ref: apps/tagma/desktop/scripts/build-host.ts
---
`--deep` will not do: it would sign every nested file with the app's entitlements. The build walks `Contents` in post-order and signs every Mach-O, framework, and `.app` before what contains them. The bundle's main executable is signed together with the bundle. Electron's helpers have no `CFBundleExecutable`, so their main file is the one named as the bundle. This assumption holds only if the `Info.plist` was read; a plist that does not parse fails the build.

Entitlements were measured on Electron 41.1.0 and macOS 26.0.1 with a self-signed certificate and hardened runtime; on Electron 44.8.0 the same set was verified by launch only — main and renderer start, not re-measured individually:
- **`disable-library-validation`** — on the app and all four helpers. Without it dyld refuses to load the `Electron Framework`: “mapping process and mapped file (non-platform) have different Team IDs”, though nobody has a Team ID. With a Developer ID it is probably unneeded, but that is not measured.
- **`allow-jit`** — on the app, Renderer, Plugin, and Helper. Without it main crashes in V8 at startup, and the renderer does not load the page. Plugin and Helper (utility processes run there, including PAC via V8) were not measured individually.
- **`device.audio-input`** — on the app and on `Electron Helper.app`, where Chromium keeps the audio service. Whether the microphone works is checked by the operator's smoke with `getUserMedia`.
- **`device.camera`** and `NSCameraUsageDescription` — on the app and on `Electron Helper.app`, by the same analogy with the audio service, for the built-in browser pages' camera. Not measured: whether the camera works is checked by the operator's smoke.
- On the GPU helper — only `disable-library-validation`. Frameworks, dylibs, `chrome_crashpad_handler`, and `ShipIt` have no entitlements.

A `.app` with no row in `HELPER_ENTITLEMENTS` fails the build. A new helper (e.g. sound capture in `Contents/Helpers`) must name its entitlements rather than silently receive empty ones.
