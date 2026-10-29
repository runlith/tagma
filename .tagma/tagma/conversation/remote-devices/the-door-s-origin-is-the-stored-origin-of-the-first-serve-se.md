---
id: 01a10cae-f9bc-72a1-b62b-ff1edfd43679
title: "The door's origin is the stored origin of the first Serve setup: gates check Origin against it, and pack watches its port"
ord: 5
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a10c98-bb9c-71b7-935b-be450ef5e0d1
sources:
  - kind: file
    ref: apps/tagma/server/src/remote/reach.ts
  - kind: file
    ref: apps/tagma/server/src/remote/tailscale/serve.ts
---
`Reach.origin` is the origin on which the Tagma mapping in Serve first stood. It lives in the `remote_origin` table and is written at the `certificate` step, right after the mapping stands. Installed PWAs, the device cookie, and push subscriptions are bound to it, so two things depend on it.

- The gates and the code exchange check `Origin` against it, not against the current Tailscale state. During warm-up after a restart (`setting-up`, `certificate`), paired devices pass instead of getting `origin-refused` like a forgery.
- Pack receives it in `expose` and looks only at its port. Someone else's mapping there yields `origin-taken` naming that mapping's target, not a move to 8443: on 8443 the phone would have neither cookie nor PWA. When the origin belongs to a different node name (the machine was renamed in the tailnet), the port is picked anew and the new origin is stored.

The door origin persists after the first mapping is set up, before the sandbox is set up: a refusal of the second one does not leave the first setup without an owner to remove it. Readiness requires the main door's answer; a sandbox refusal does not close it — it is visible separately in `read_remote_access.sandbox` and yields `sandboxOrigin: null`. Someone else's mapping is not replaced, and no command to replace it is offered. The pairing code is issued only in `ready`: the QR must point at an origin that already answers.
