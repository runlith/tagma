---
id: 01a1258b-4bed-7190-a24c-92dbc781ec39
title: Each plugin gets its own sandbox origin so third-party widgets (YouTube and others) work inside the view
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1258b-8be1-7416-a06c-2562099c95d5",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/views/ViewFrame.svelte
  - kind: file
    ref: apps/tagma/server/src/mcp/sandbox.ts
  - kind: file
    ref: apps/tagma/server/src/views/files.ts
---
The plugin's view now runs in a nested iframe with no `allow-same-origin` (opaque origin). Sandbox flags inherit into nested iframes, so the embedded YouTube player in the `music` view fails (`writeEmbed is not defined`, `error_204`) — a black square with no sound. The same would break any third-party widget. This is an architecture defect: the user asks for “music with YouTube” and gets a broken view.

Goal: each plugin's view gets its own origin (e.g. `<plugin>.sandbox.localhost:<SANDBOX_PORT>` locally), where the view is an ordinary page with its own origin. Isolation rests on origin difference: the Tagma door refuses these origins, plugins cannot reach each other or the MCP Apps proxy. Remote access (Tailscale Serve, one hostname per node) must work or get an honest explicit decision.

Start with `apps/tagma/server/src/mcp/sandbox.ts`, `apps/tagma/server/src/views/files.ts`, `apps/tagma/app/src/lib/features/views/ViewFrame.svelte`, note [[960e5e20]].

Done when: `music` in the browser really plays YouTube; isolation proved by tests (a foreign plugin and view cannot reach the door or a neighbor); note [[960e5e20]] and the spec fixed to the new design.
