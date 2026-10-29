---
id: 01a17aff-0013-783e-93b0-821a3676635a
title: Remote access exposes the terminal endpoint as a Tailscale Serve site on its own HTTPS port
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17ae0-48f6-7cff-9adb-353003be8a0d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17aff-0013-783e-93b0-8215dc3c916a
  - kind: waits-on
    to: 01a17aff-0013-783e-93b0-82187374bf6c
sources:
  - kind: dir
    ref: apps/tagma/server/src/remote
---
While `remote.enabled`, the terminal stream endpoint stands in Tailscale Serve as a site, like plugin sites, and is taken down with them; the server hands its remote address to a window that arrived remotely.
