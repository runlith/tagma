---
id: 01a10c6e-f97d-7670-a3d6-9058843f8d21
title: A device on a remote WebSocket is identified by the upgrade request context, not by RPC message headers
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/http/remote.ts
  - kind: file
    ref: apps/tagma/server/src/socket/live.ts
  - kind: symbol
    ref: apps/tagma/server/src/invocation/contract/service/admission.ts
    symbol: CallDevice
---
The remote door's gates (`composition/http/remote.ts`) check the account and the Origin before the upgrade, and `Admission.remote` puts the `CallDevice` into that request's fiber context. The Effect 4.0.1 RpcServer runs each socket message's handler in the context of the fiber that called `server.write` (`handlerContext(entry, requestFiber.context)` in `src/rpc/RpcServer.ts`) — and that is the upgrade request's fiber, which reads the socket until it closes. So every call on the socket sees the device admitted at upgrade, and `admit` makes it an operator with a `deviceId` without reading headers.

RPC message headers do not work for this: Effect merges handshake headers with message headers, and the client overrides any of them.

Three things keep this true. First, `CallDevice` defaults to null — a local operator — so the remote listener is assembled only through `remoteServing`, where the gates wrap the whole app. A request that was not admitted never reaches API and data: the gates answer the shell or the code exchange themselves, and compare the path in the form the Effect router sees it — lowercased, after percent-decoding, without repeated or trailing slashes. The path is taken from the request line as is: `new URL` would read a leading `//` as authority. A classification error of this kind answers the shell, never data. Second, a socket admitted before revocation but registered after it is closed by `Connections` at once, because it remembers the revoked device for a minute — comfortably longer than the path from admission to socket registration; the record is then removed. Third, when an Effect upgrade moves handlers to another fiber, admission at upgrade stays, but calls on the remote socket lose their `deviceId`. `remote/door.itest.ts` checks admission and socket closing on revocation, but not call attribution on the socket.
