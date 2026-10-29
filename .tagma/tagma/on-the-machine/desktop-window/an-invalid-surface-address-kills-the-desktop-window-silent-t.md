---
id: 01a0caac-2226-77db-9fa8-dbb4cb14d9a9
title: "An invalid surface address kills the desktop window silent: the throw lands in an uncaught promise"
ord: 34
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/desktop/src/config.ts
  - kind: file
    ref: apps/tagma/desktop/src/main.ts
---
`resolveSurfaceUrl` throws on a garbage address (`new URL` at `config.ts:13`) or a non-http(s) protocol (`config.ts:14-16`), and its only caller runs it inside `app.whenReady().then` with no catch (`main.ts:146-147`). A window launched with an invalid surface address — a bad `--tagma-surface-url`, a bad `TAGMA_SURFACE_URL` — dies in an unhandled rejection with no window ever created: a Finder-launched operator sees nothing at all, not even the waiting page that names misconfiguration elsewhere.

The honest repair shows the failure rather than dying silent: stand the window on the waiting page with the verdict, or refuse the address before the app half-boots. What it must not do is keep throwing where nobody renders.

Found by the zone review of [[c04717c7]] for [[a014cd4c]]; it implements no decision of its own. Done when an invalid surface address answers a page or a refusal instead of an unhandled rejection.