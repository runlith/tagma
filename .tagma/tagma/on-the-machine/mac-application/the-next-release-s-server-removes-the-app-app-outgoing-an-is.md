---
id: 01a1a23c-7b04-7d59-97e9-9e6295611fe8
title: The next release's server removes the `.<App>.app.outgoing` an issued window left beside the person's application
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a255-1dad-78a2-b0c2-4ebc6f454ac0",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a13cca-55a0-7b12-a0d5-c78c1fe1ff84
sources:
  - kind: file
    ref: apps/tagma/server/src/mac-applications/placement.ts
---
Windows of 0.2.0–0.2.2 delete the replaced bundle with Electron's asar-aware fs: `Contents/Resources/default_app.asar` stays inside `.<App>.app.outgoing` and the replacement throws ENOTEMPTY (fixed in the window by 842ccb48f5). Such a leftover makes an issued window fail `settleOwn` at every start (Try again opens it) and fail `recoverBundle` before every later replacement, so once a newer release stands, the issued window can never become it and Try again repeats the error. A fixed window removes the leftover, but an issued window has to replace itself with one first. So the release that carries the fix must have its server — which reads files without the emulation — remove the leftover beside the person's application before the issued window follows it. The server does not know that place today; the window's main pid arrives in its `WindowDeclaration`, and its executable path names the bundle. Until this lands, the leftover is removed by hand: `rm -rf "/Applications/.Tagma.app.outgoing"`.