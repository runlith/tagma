---
id: 01a10c6e-f98c-7987-a5c9-1ff29cbda211
title: A Tailscale Serve mapping is removed only when remote.enabled is switched off, not when the server stops
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/remote/reach.ts
  - kind: file
    ref: apps/tagma/server/src/remote/tailscale/mapping.ts
---
A mapping counts as Tagma's only when the `/` handler on the `<host>` port proxies exactly to the local remote-door or sandbox listener, and on the terminal endpoint site's stored port — to any loopback port ([[2e612cfd]]). The door keeps its HTTPS port from 443 and 8443, the second one goes to the proxy MCP App, and the terminal site gets its port from a separate range ([[2e612cfd]]). Everything else is foreign, and pack does not touch it. Pack reads a mapping from a foreground `tailscale serve` session but never removes it: `serve … off` applies only to the background configuration.

Stopping the server closes the listener but leaves the mapping. `--bg` keeps it in the tailscaled config, and on the next launch pack accepts it without a command, so the phone's origin does not change. Only switching `remote.enabled` off removes the mapping, including when caught at startup. `shut` in `reach.ts` calls `Exposure.withdraw` on the configured port, and pack removes the Tagma-owned mappings of the door, proxy and terminal site — even when the listener never opened — and repeats the removal with a pause growing to a minute until Tailscale confirms it; turning access on interrupts the repeats. Otherwise the mapping would keep pointing at a port any process may take after Tagma — under an origin phones and their cookies trust.

An installation that never stored an origin removes nothing and never calls tailscale at startup. Removing on every stop would add an outside CLI call with its deadline to server shutdown, and a fresh Serve setup to every launch.
