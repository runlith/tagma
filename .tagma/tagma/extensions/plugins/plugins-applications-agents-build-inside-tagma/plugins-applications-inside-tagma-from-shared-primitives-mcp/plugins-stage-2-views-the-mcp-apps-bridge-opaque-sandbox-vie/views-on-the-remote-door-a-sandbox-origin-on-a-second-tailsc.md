---
id: 01a1236e-0adf-7dc2-babd-bb7996c6f53e
title: "Views on the remote door: a sandbox origin on a second Tailscale Serve port, frame policy, and /p/* instead of the SPA shell"
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1236e-4b87-7d55-b50d-ea961093fa84",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
---
The spec's “View and bridge” section → “Isolation”: on the remote door the view's proxy lives on a second Tailscale Serve port, the frame policy opens for it (`http/remote.ts`); `/p/*` now serves the SPA shell (`composition/http/remote.ts`) — it serves the plugin's statics ahead of the device gates. The MCP Apps host (`159b403db`) now shows views only on loopback.

Verified: server and app typecheck; 12 remote-door integration tests and 4 Exposure tests — public `/p/*`, framing, API admission, binding and websocket on sandbox refusal, project-name reservation, both conformances, collision, Funnel, partial refusal and teardown. A separate `tagma:try` instance confirmed opaque isolation of an MCP App and a static view in the browser, including direct navigation to `/p/*` after the service worker activates; ES modules, wasm, and blob Workers work, storage and direct API are unavailable. The instance is stopped. Sol xhigh and Opus xhigh did one review round, confirmed findings closed. A real Tailscale Serve and a phone are unverified: the operator forbade touching working Serve matches.
