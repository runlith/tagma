---
id: 01a13bfd-972f-73fc-8420-939e4da86039
title: "Move to Effect style: the plugins, plugin-secrets, views modules"
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13bfd-c293-72bd-a045-01132dc9f275",
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/secrets
  - kind: dir
    ref: apps/tagma/server/src/plugin-host
  - kind: dir
    ref: apps/tagma/server/src/views
---
Scope: `apps/tagma/server/src/plugins/`, `plugin-secrets/`, `views/` — production code and tests (measurement 2026-10-14: ~120 sites together). Proof is zero effect-style findings for each, typecheck and tests green, spans preserved.
