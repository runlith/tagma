---
id: 01a123d3-6364-73b7-8f5f-e1d7bd98fec0
title: "Plugins, stage 2, acceptance: Doom without a process — a WASM build in an OS window on desktop and in a panel on web"
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a123b1-e4fb-7781-90d4-f033d7a6365c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
---
Stage 2 acceptance of spec [[a0a16218]] on a static view: the `.plugins/doom/` plugin on the runlith project floor, only `ui/` (a Chocolate Doom WASM build from cloudflare/doom-wasm with the shareware WAD), `plugin.json` with `views` and `launchers`, no `process`. The acceptance rule: only the plugin package is edited; when Tagma falls short, work stops and returns the missing contract to its owner (pointer lock, fullscreen, sound, wasm, Worker in the opaque view).

Done when Doom starts from the palette and rail in an OS window on desktop and in a floating panel on web, plays with keyboard and mouse and with sound. The live run of the Electron path (OS window, IPC, reveal) and the review fixes (geometry, raise, layers) belong here too.
