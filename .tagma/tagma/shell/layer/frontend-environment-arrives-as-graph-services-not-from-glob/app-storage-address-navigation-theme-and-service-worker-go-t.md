---
id: 01a14fe9-9f2a-77a2-b527-f53f1ee3393f
title: App storage, address, navigation, theme and service worker go through Platform, Router and their own services
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14ff7-54a2-7e06-a406-57dc2c8672a9",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14fd8-3e41-7f9d-909a-f909b96e483e
  - kind: waits-on
    to: 01a14fd8-68cd-7412-b239-945d0da3edb9
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features
  - kind: file
    ref: packages/layer/src/Router.ts
---
Task 5 of spec [[b96e483e]], the "Storage", "Address and navigation", "Browser capabilities" (except touch and OS) sections and the `dark` class of the audit [[dbf104d3]]. `localStorage`/`sessionStorage` through `Platform.storage`; `Router` in Layer gains `reload`, `load`, `onNavigate`, and `goto`/`page` from `$app/*` in features move to `Router`; `ClientBuild`, `ServiceWorkers`, a `Theme` service instead of the singleton, `dark`-class readers onto `Theme.mode`; `Platform.languages` instead of `navigator.language`. The `Router` changes in Layer go in this task; `Platform.databases`/`locks` come from the wire task. Work per the frontend skill [[0da3edb9]]. Proof: the region has no storage, `location`, `history` touches or `$app/navigation`/`$app/state` imports outside the audit-allowed places; the app typecheck and build pass.
