---
id: 01a17d88-4752-7529-b02c-fdff32cb2311
title: "A published release the standing host will not take does not switch itself on: take is checked before `install-from` moves `current`"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17ae0-48f6-7cff-9adb-353003be8a0d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17d2b-ffc2-717d-8c2a-e2e056ff6fb0
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/host/departure.ts
  - kind: file
    ref: apps/tagma/server/src/release-channel/install.ts
---
A published release the standing host will not take does not switch itself on: take is checked before `install-from` moves `current`. The delivery [[d352bac7]] review found that host take before the switch works only for checkout builds (`bundle.next` → `restart` → `SuccessionSteps.prepare`). A published release is installed by an attempt (`release-channel` → `install-from` → `openAttempt`), and per [[9e8adf53]] the `to` release does not touch the host before its door but takes it after the door (`placeOverForeign`). So every ordinary Tagma user gets the switch and then a `standing` card with `Open <past>`: nothing closed, but new terminals do not start. The spec promises otherwise: a version the host will not take does not switch itself on.

What is needed: for a published release, the standing host logic's verdict on the release bundle arrives before `install-from` moves `current`, while `from` still serves. A refusal returns a ready installation with the price in `machine.newHost` (`cause: update`) and does not switch; an acceptance is the same act as for checkout builds. The `to` attempt and the [[9e8adf53]] ban on touching the host before the door do not change: the `from` side runs the check. A release without this check and an issued host without the needed verb behave as today.

Acceptance:
- itest through the release door: the standing logic refuses the release bundle → `current` unmoved, the `from` server and host serve, executions alive, `machine.newHost` carries the price.
- itest: a taken release installs as today.
- [[9e8adf53]] and [[c1c02c1c]] fixed where what they say changes.
