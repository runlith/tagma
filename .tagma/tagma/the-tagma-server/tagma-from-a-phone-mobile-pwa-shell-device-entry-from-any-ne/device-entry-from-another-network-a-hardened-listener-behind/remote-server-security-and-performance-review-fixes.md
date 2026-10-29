---
id: 01a10c98-bb9c-71b7-935b-be450ef5e0d1
title: "Remote server: security and performance review fixes"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10c98-f626-735b-9f7a-6045cf58d289",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a10c46-51dc-7b25-9f6a-c5ed6fee8958
  - kind: implements
    to: 01a10b84-a62c-7c1f-a5ff-786268a2d306
sources:
  - kind: dir
    ref: apps/tagma/server/src/remote
  - kind: file
    ref: apps/tagma/server/src/composition/http/remote.ts
  - kind: file
    ref: apps/tagma/server/src/socket/connections.ts
---
Server fixes for [[68a2d306]] following the review of commits 329d10b705, 63069a965d and 14d8256c45: Opus reviewed security, Muse reviewed performance. The spec already reflects these decisions — the "Listener", "Credential and pairing" and "Tailscale" sections.

## Security

1. `frame-ancestors 'none'` and `X-Frame-Options: DENY` on every remote listener response, artifacts included.
2. The installation keeps the origin of the first successful setup. Someone else's mapping on its port later is a blocked state with its target, not a move to 8443. `Keeper.admit` compares the Origin against the stored one and never refuses devices during `setting-up` and `certificate`: right now that is a 403 `origin-refused` there.
3. The mapping is removed by its target `127.0.0.1:<remote port>`:
   - on switch-off — even when `listen` failed (`Reach.shut` now only removes when `port !== null`), retrying until confirmed;
   - starting with access off removes the leftover Tagma mapping;
   - a `status` or `serve status` failure is retried, not just logged.
4. Funnel: `ServeConfig` reads `AllowFunnel` and `Foreground`. A Tagma mapping with Funnel is a blocked state: the listener does not serve, the state carries the command that switches Funnel off. Check the format against a genuine `tailscale serve status --json` or the `ipn.ServeConfig` source.
5. Removed by the operator: the device issues codes on equal terms with the machine, `create_pairing` never refuses a device.
6. Code exchange: the Origin is checked before the body is read, the body is limited to 1 KB.
7. The gates stand inside `requestLine`: 401, 403 and 429 answers and exchanges reach the call journal.
8. The gates normalize a path with a leading `//` just like the router does, or refuse such a path. The test sends a raw path, not through `fetch`, which collapses it.
9. Without a credential no `*.map` is served.
10. Test: a WS with a valid cookie and someone else's Origin is refused.

## Performance

11. `Reach` keeps a minimum interval between `expose` attempts: polling the settings section never launches `tailscale` on every read.
12. `tailscale status` parses only the machine's own facts (`--peers=false` or equivalent), not the whole tailnet.
13. `/health` and upgrade write `lastSeenAt` and `expiresAt` and set the cookie only once the mark is stale — older than an hour, say — or the term nears its end.
14. `Connections` remembers a revoked device only for a short window, then the entry is dropped.

Done when every item is fixed or refuted with code and reasoning, the server typecheck is clean in the touched code, and `composition/testing/remote/door.itest.ts` is green together with the new checks.
