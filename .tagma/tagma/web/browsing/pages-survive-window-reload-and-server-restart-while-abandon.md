---
id: 01a14c08-1c3f-7bde-a2e3-046c485baab2
title: Pages survive window reload and server restart, while abandoned ones unload and restore by URL on next access
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046de2a2ecf8
sources:
  - kind: file
    ref: apps/tagma/desktop/src/browser/connection.ts
  - kind: file
    ref: apps/tagma/desktop/src/browser/host.ts
  - kind: file
    ref: apps/tagma/server/src/browser/hosts.ts
  - kind: file
    ref: apps/tagma/server/src/browser/pages.ts
  - kind: file
    ref: apps/tagma/server/src/browser/store/ledger.ts
  - kind: file
    ref: apps/tagma/server/src/desktop-browser/attachment.ts
---
**Value.** Open pages are not lost to a window reload, a server restart, or a long idle stretch, and abandoned tabs do not eat the machine's memory.

**How.** Pages are project records on the server; live pages are held by hosts. State in `list_pages`: `live`, `dormant` (host connected, page unloaded), `away` (no host).

**Behaviour.**
- A desktop page lives in the application main process and survives surface reload and server restart; after reconnect the host reconciles live pages with records, and an agent action waits for the host's return while the application process lives. An incoming host becomes available once its subscribers finish: calls arriving in between wait for readiness, and closing the connection during that window answers with a refusal.
- Unshown pages without an agent unload: desktop — past the machine-memory limit, managed Chromium — after 15 minutes without an engine session. An unloaded page is restored from its record by URL and history on next show or action.
- A closed page joins the project's last 20 closed pages; ⌘⇧T reopens the last one.
- A popup opened by a page becomes a project page with the same opener.

**Limits.** Unloading loses unsaved form state, and on managed Chromium also back-forward history. A page whose host is gone shows but does not work until the host returns.
