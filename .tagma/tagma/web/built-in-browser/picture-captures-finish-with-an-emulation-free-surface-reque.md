---
id: 01a185e7-febb-7233-b05e-9d38d0baf766
title: Picture captures finish with an emulation-free surface request
ord: 41
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/engine/drive.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/pictures.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/read.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/screencast.ts
---
Chromium temporarily changes device emulation and widget size for clips and for unclipped captures under emulation; restoring those values does not establish a restored compositor surface. Images stay on the emulation-owning session so it restores its own parameters. A lazily acquired capture-only session requests an unclipped surface frame without emulation writes; using the primary session would repeat its mutation. This redraw belongs to the root widget and does not join descendant widgets' compositor submissions. On macOS, [Electron 44.8's native widget](https://github.com/electron/electron/blob/v44.8.0/shell/browser/ui/cocoa/electron_native_widget_mac.h) inherits [the in-process application host](https://github.com/chromium/chromium/blob/152.0.7977.167/ui/views/widget/native_widget_mac.mm#L1078-L1080), and [ordinary managed Chromium tabs cannot select the app-shim remote host](https://github.com/chromium/chromium/blob/151.0.7922.71/chrome/browser/apps/app_shim/app_shim_manager_mac.cc#L668-L682). Their native resize synchronously embeds the restored parent surface generation before returning; the later [surface copy](https://github.com/chromium/chromium/blob/151.0.7922.71/content/browser/renderer_host/delegated_frame_host.cc#L143-L158) requires that generation or newer. That copy, rather than the forced-redraw callback, is the restoration barrier for the same live widget without concurrent resize, emulation or navigation. The admitted image-and-frame-request transaction survives caller interruption. Visible element and pick pictures crop the returned viewport PNG through Sharp’s asynchronous native pool, using effective device-pixel and visual-viewport scales: scrollbar-excluding content dimensions cannot determine scale from a whole-widget image. Chromium’s [per-session handlers](https://github.com/chromium/chromium/blob/151.0.7922.71/content/browser/devtools/render_frame_devtools_agent_host.cc#L347-L404) and [disabled-emulation no-op](https://github.com/chromium/chromium/blob/151.0.7922.71/content/browser/devtools/protocol/emulation_handler.cc#L979-L994) are what make the separate barrier non-mutating. The surface request takes a [hidden capturer hold](https://github.com/chromium/chromium/blob/151.0.7922.71/content/browser/devtools/protocol/page_handler.cc#L1330-L1336) and forces redraw, so an idle or hidden page need not paint spontaneously.