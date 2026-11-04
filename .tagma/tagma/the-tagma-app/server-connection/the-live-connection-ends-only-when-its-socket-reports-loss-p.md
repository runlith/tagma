---
id: 01a1a606-970c-7f96-b02d-3f4fae2d324c
title: The live connection ends only when its socket reports loss; pings keep going out so a dead remote path still errors the socket
ord: 5
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1489c-3f8d-7afd-89e0-b8d384602e88
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/wire/Live.ts
  - kind: symbol
    ref: apps/tagma/server/src/platform/contract/wire/live.ts
    symbol: liveProtocol
---
No deadline tells a server that stalls under load from one that is gone, and a stall of ten seconds is ordinary on a loaded machine. Effect's socket protocol ended the connection when a ping went unanswered past the next one (five to ten seconds), and each such stall dropped every feed and failed every call in flight as `transport`. So the connection runs with `pingTimeout: false` (a hunk of the effect patch) and no open deadline: it ends only on the socket's `close` or `error`. `liveProtocol` in the live wire contract is the one place that pair stands; the app, the desktop host, the CLI and every test client build their socket protocol through it.

The window may reach a server on another machine (a paired device through Tailscale), where a dead path sends no close. That is why the pings keep going out every five seconds, answered or not, and are not switched off: a dead path leaves them unacknowledged, and TCP gives up and errors the socket. A stalled server's kernel still acknowledges them. Detection of a silent dead path then takes the operating system's retransmission timeout, minutes rather than seconds. That is the trade accepted against dropping a live connection whenever the server is busy. Faster facts stay in front of it: a server process that exits resets the socket at once, a vanished interface errors it, and a page back from more than `AWAY_MS` in the background renews the connection.
