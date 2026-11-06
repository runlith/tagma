---
id: 01a12341-60c3-7fb8-9b87-19a2960e5e20
title: Someone else's MCP App view is isolated by two layers, and any view's connection is tied to the mounting, not the view
ord: 1
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1231d-99c0-74e1-9e30-779efe94e581
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/views
  - kind: file
    ref: apps/tagma/server/src/composition/http/local.ts
  - kind: file
    ref: apps/tagma/server/src/mcp/sandbox.ts
  - kind: file
    ref: apps/tagma/server/src/composition/http/sandbox.ts
---
Someone else's MCP App view is isolated by two layers, and any view's connection is tied to the mounting, not to the view itself.

Someone else's HTML is isolated by two layers, as the Sandbox proxy section of the MCP Apps spec requires. The application embeds a proxy from a separate sandbox origin — locally the `SANDBOX_PORT` on loopback (by default offset from `TAGMA_PORT`), remotely a second Tailscale Serve HTTPS port on the same node; `mcp/sandbox.ts` serves the page, and the iframe gets `allow-scripts allow-same-origin`. The proxy puts the HTML into a nested iframe's `srcdoc` without `allow-same-origin`: the view gets an opaque origin, has no browser storage, and `parent` is closed to it. The view's CSP arrives in the proxy address query and is set as a header: `srcdoc` inherits the embedding document's policy, and the view could rewrite a meta tag. A separate port, not the artifact pages' origin: an artifact opened in an iframe of the same origin would reach the neighbouring proxy and speak to the host in its name.

The CSP does not open this machine to the view: domains declared by the server with `localhost` (and `*.localhost`) and bare IP addresses are dropped, and `frame-ancestors` admits the proxy only into this server's doors — loopback pages and the exact saved origin of the remote door (`framedBy` in `composition/http/sandbox.ts`). The boundary here is the door, not the CSP: a name resolving to 127.0.0.1 is not caught by the CSP. The local door (`composition/http/local.ts`) answers only loopback Host and refuses `origin-refused` to a page with an opaque (`null`) origin, any other name but `localhost`, `127.0.0.1`, and `[::1]` (including a `<name>.localhost` host), or with a sandbox or artifact port — so the view cannot reach the operator's HTTP and socket.

The connection belongs to the mounting, not the view. `ViewBridge` accepts a message only when its `source` is its own iframe's window and its `origin` is that iframe's origin: the sandbox origin for an MCP App proxy. The server, its identity (the declaration fingerprint at call time, from `display.app`), the resource, and the thread the bridge takes from the closures the host's methods gave it, never from message parameters. When the server name is since declared anew, open, read, call, and subscribe refuse `mcp-server-replaced`: one declaration's HTML and data do not go to another. A nested frame writing to `top` directly gets no answer. Subscriptions and unfinished requests live in the bridge and are removed in `dispose`; a subscription on the server lives while the `mcp.resource.subscribe` feed is open, resumes itself after the server reconnects, and ends with a refusal rather than silence.

A view's capability is a record in `ViewHost.methods` (and `capabilities` for the handshake); a missing method answers `unavailable` (-32601). Someone else's MCP App gets only the `tools/call` of its own server's tools with app visibility, `resources/read`, subscriptions, `ui/open-link` on click, and `ui/request-display-mode`; `ui/message` and `tagma/*` are closed to it, because someone else's HTML does not act for the operator. `display.app` is set only by the catalog that allowed views to the caller (`apps: true` for MCP projects) — plugin tools address their views differently.

`ui/resource-teardown` is a request with a wait, which the shared `Frame` carries out ([[1320848c]]). `/health` declares this door's MCP App proxy origin: the local sandbox port or the HTTPS origin of the second Serve mapping. The remote listener opens after the pack answers about the sandbox setup: the first `/health` load gets the checked proxy origin or `sandboxOrigin: null` on its refusal. An origin of a port held by someone else's service is not declared. A sandbox refusal disables only MCP App views, does not close the main door, and is visible separately in `read_remote_access.sandbox`; the client accepts the address with no port listing of its own.
