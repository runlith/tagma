---
id: 01a1236e-0adf-7dc2-babd-bb78eea92af2
title: "Plugin views on the bridge: the views and results points, pinned mounting, static /p/*, and the tagma/open, tagma/storage, tagma/thread extensions"
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1231d-b9cc-7eb6-be22-add828aa44c4",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
---
The spec's “Manifest” (view, mounting, resource) and “View and bridge” sections. On the `ViewBridge`/`ViewFrame` bridge (`159b403db`) plugin views connect: the `views` and `results` points are declared by their owners through `PluginPoints.declare`; the pinned view ([[07e5776a]]) mounts; the plugin's `ui/` statics are served by `/p/*` on the local door ahead of the device gates with `Access-Control-Allow-Origin: *`; process → view goes through the plugin's subscribed resource (`subscribeResource`). The plugin's view gets `tools/call` to `view`-audience tools with caller `operator {view, threadId?, bindings?}` and the `tagma/open`, `tagma/storage`, `tagma/thread` extensions; a foreign MCP App still gets none of them. The `tagma/storage` answer waits on the `ui/resource-teardown` reply from [[0c2dbada]].

Done when a test plugin with a view and a process shows: its tool's result draws the view in the ribbon; the pinned view mounts above the ribbon; the process's resource update reaches the view; `tagma/storage` survives remounting; `tagma/thread` serves the text and run status; `tagma/open` opens the thread; the view cannot name itself another plugin. On desktop and web.
