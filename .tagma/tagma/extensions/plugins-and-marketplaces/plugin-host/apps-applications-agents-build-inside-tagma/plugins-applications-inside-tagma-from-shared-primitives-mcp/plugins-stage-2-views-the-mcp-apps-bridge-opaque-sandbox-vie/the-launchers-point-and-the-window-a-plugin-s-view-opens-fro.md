---
id: 01a123b1-a094-72bd-b4ab-f7606307a615
title: "The launchers point and the window: a plugin's view opens from the palette and rail without a process, in an OS window on desktop and a floating panel on web"
ord: 9
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
The spec's “Contribution points by stage” sections → “Window”, “Starting without a process”. The `launchers` point (`{view, title}`) is declared by its owner through `PluginPoints.declare`; launching appears in the palette and rail; the view opens in a “window” — one place with platform adapters: an OS window on desktop, a floating panel on web (`floating` and `window` are not separated). A view without a process (only `ui/`) works: that is how Doom starts. A view in a window gets the same bridge and the same extensions as in the ribbon. Here too — declaring the manifest's `pins` point ([[88151d7d]]).

Done when a process-less test plugin opens from the palette in a window on desktop and in a floating panel on web; closing the window drops the mounting and subscriptions; a manifest with `contributes.pins` is accepted.
