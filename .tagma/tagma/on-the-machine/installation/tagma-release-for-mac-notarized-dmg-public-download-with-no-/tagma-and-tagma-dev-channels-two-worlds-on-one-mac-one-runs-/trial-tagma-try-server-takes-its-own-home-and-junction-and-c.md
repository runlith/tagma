---
id: 01a13ce3-023c-7f20-b5ea-32978b15e113
title: Trial tagma:try server takes its own HOME and junction and comes up while Tagma Dev runs
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13c9d-2ae3-7f61-9eb3-0f8dfbe17c55",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13c9b-c2eb-7fa3-95cc-fb7ce00dc24e
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/cut/try.ts
---
The `tagma:try` server takes the junction (`active.lock`, entry point) from the calling `HOME` — the same as the operator's Tagma Dev — and fails with `channel-active` while Tagma Dev runs. Spec: a trial instance with its own `HOME` has its own junction.

To do: `installation/cut/try.ts` runs the server (and its CLI calls to it) with `HOME` inside the trial instance root (`beside.ts`); the build (`cut`, login-keychain signing) runs with the real `HOME`. Its own `HOME` also keeps the trial server's home harness integrations away from the operator's homes.

Done: `bun run tagma:try` while Tagma Dev runs raises the trial server, it answers on its port, the operator's server keeps running.
