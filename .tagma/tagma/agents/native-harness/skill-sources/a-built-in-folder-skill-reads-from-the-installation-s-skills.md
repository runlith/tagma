---
id: 01a159db-b9ca-7ff1-9921-9a3a675af09a
title: A built-in folder skill reads from the installation's `skills/` next to the server bundle, while a server from sources reads it in native-harness
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/cut/skills.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/skills/shipped.ts
---
An agent reads a skill folder's `references/` by the absolute `location` that `load_skill` answers, so an installed server must point at its installation, not at the checkout it was built from: the checkout may move on or switch branches. A release copies each `native-harness/skills/<name>/` folder into the installation's `skills/`; this is part of the closure with the server role, its bytes checked with the rest of the parts. `SHIPPED_SKILLS` looks for `../../skills/` from the bundle (`bin/server/`) and, failing that, takes its own module folder — so a server started from sources reads skills straight from the checkout. An installation without this folder serves no folder-style built-in skills: there are none in `bin/server/`.
