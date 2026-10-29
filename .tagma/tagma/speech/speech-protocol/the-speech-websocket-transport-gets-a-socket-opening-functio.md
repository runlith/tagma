---
id: 01a107da-8478-752f-a757-5aa360705af2
title: "The speech WebSocket transport gets a socket-opening function from the host, not a constructor: Bun and `ws` share no call shape with headers and subprotocols"
ord: 7
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/speech/src/transport/websocket.ts
---
Bun passes headers only in the `new WebSocket(url, { headers, protocols })` shape: in the `(url, protocols, { headers })` shape it silently drops the headers, and the provider key with them. `ws` takes headers only in the `(url, protocols, { headers })` shape: it reads an object second argument as options and drops subprotocols. So `webSocketTransport(open)` takes `OpenSocket(url, protocols, headers)`, and each host's composition calls its own constructor in the right shape. Verified on Bun 1.4.2 and `ws` 8; `websocket.itest.ts` runs both openers against one local server.

The socket is created synchronously inside `acquireRelease`, and waiting for `open` happens outside. So an interrupted handshake closes the socket at once through the finalizer and holds no connection the server never answered.
