---
id: 01a14a0b-b9c8-736b-83fa-567d3de2a6c5
title: A managed-Chromium profile session is a hidden target in its browser, because a browser target does not know Network.getAllCookies
ord: 8
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/managed-browser/host.ts
    symbol: makeManagedHost
  - kind: symbol
    ref: apps/tagma/server/src/managed-browser/targets.ts
    symbol: profileTarget
---
Import writes and removes cookies through one path on both hosts — the `Network` domain. On the root browser session, Chrome for Testing 151 answers `'Network.getAllCookies' wasn't found`, while `Storage.*` exists there; on desktop it is the other way round: `Storage.*` in the `webContents` session (Electron 44.8.0) reads and writes outside the profile partition — neither `Network.getAllCookies` nor `session.cookies` sees what it wrote, and it keeps no `partitionKey` — while `Network.*` works with the partition. So the managed host's `ProfileHost.session` creates a `Target.createTarget` with `hidden: true` in the profile context and hands over that target's session: it never shows as a tab, never enters the page registry, and closes with the session scope. A shown profile with no page open has no frame target to allow `hidden: true`, so there the session holds a background `about:blank` window instead, closed with the same scope.
