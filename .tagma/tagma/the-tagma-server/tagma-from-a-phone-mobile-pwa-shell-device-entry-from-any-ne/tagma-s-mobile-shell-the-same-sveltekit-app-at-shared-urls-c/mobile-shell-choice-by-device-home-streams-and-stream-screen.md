---
id: 01a10c46-51dc-7b25-9f6a-c5ee3db4ab5a
title: "Mobile shell: choice by device, Home, streams and stream screens, PWA, live channel after background"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10b63-faa6-7691-9b8f-2144e40541ec",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a10b84-bec8-7182-b0bf-018c6ab92e8d
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/runtime.ts
  - kind: file
    ref: apps/tagma/app/src/routes/+layout.svelte
---
[[6ab92e8d]] without pairing and unpaired-device states (`/pair`, `Unpaired`, device refusal in `Standing` — that is [[57f030fc]]) and without push in the service worker (that is [[f5eaf5ea]]). Developed over loopback through the manual shell choice. Start with `hostOf()` in `lib/app/runtime.ts` and `routes/+layout.svelte`.

Done when the v1 screens work under iPhone emulation in DevTools with manual choice, the desktop browser at 390 px stays desktop, Electron registers no service worker, and returning from the background yields a fresh feed.
