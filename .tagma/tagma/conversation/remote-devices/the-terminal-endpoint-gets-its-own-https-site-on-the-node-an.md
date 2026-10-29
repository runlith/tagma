---
id: 01a17b7e-aaf5-7042-b36c-992e2e612cfd
title: The terminal endpoint gets its own HTTPS site on the node, and its mapping follows the flow's port on the next remote lane opening
ord: 8
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a125bb-4451-75a5-ba96-3eb0a7089c76
  - kind: relates
    to: 01a17aff-0013-783e-93b0-8215dc3c916a
sources:
  - kind: file
    ref: apps/tagma/server/src/remote/tailscale/withdrawal.ts
  - kind: file
    ref: apps/tagma/server/src/remote/terminalSite.ts
  - kind: symbol
    ref: apps/tagma/server/src/remote/tailscale/mapping.ts
    symbol: pointsHome
---
The host's terminal flow listens on a loopback port that changes with every host logic, and the server can learn the port only from the `OpenTerminalLane` answer ([[303715ed]]). So the site is set lazily: a remote lane opening calls `TerminalSite.origin(port)`, and when the mapping points elsewhere, `Exposure.point` rewrites it on the same HTTPS port. Until the next remote opening, the mapping points at the departed logic's port.

- **The site port is stored for removal, not for the origin.** The HTTPS port comes from its own range, separate from app sites ([[a7089c76]]): other fibers set those, and two plans could take one port from a shared range — then one line in `remote_site` would displace the other's. The port is stored under the name `:terminal`, which is not among app ids. The browser stores nothing in this origin, so the port may change. A mapping on this port that proxies to any loopback port counts as its own — when rewriting and when `remote.enabled` is off, including after a server restart when the flow's old port is no longer known; otherwise it would keep pointing at a port any process may take.
- **One queue of config writes.** App-site `serve` calls and the terminal-site call go under one permit: each rewrites the tailscaled config.
- **Admission is the lane secret.** The remote door's gates do not stand on the site: the flow lets through only WebSockets with the lane secret, and only the window that opened the lane through the admitted door gets the secret.
