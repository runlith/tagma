---
id: 01a10c46-51dc-7b25-9f6a-c5ed6fee8958
title: "Server: the remote module — a hardened listener, device admission on HTTP and WS, pairing, revocation, Tailscale Serve, sandboxed artifacts"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10c46-cf41-725f-b8e7-3b8ca5ce8590",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a10b84-a62c-7c1f-a5ff-786268a2d306
sources:
  - kind: dir
    ref: apps/tagma/server/src/invocation/admission
  - kind: file
    ref: apps/tagma/server/src/composition/server.ts
  - kind: file
    ref: apps/tagma/server/src/socket/live.ts
---
The whole server side of [[68a2d306]] except the "Phone & devices" section — [[57f030fc]] paints that. Start with `invocation/admission/actor.ts`, `socket/live.ts`, `composition/http/door.ts` and `composition/server.ts`.

Done when the spec's acceptance holds, except the live-phone checks: no data under forged headers, a parallel code exchange yields one device, revocation closes the open WS, the sandboxed page never reaches the API, enabling access on a Tailscale machine yields a working origin. Tests cover the admission, exchange and revocation contracts.
