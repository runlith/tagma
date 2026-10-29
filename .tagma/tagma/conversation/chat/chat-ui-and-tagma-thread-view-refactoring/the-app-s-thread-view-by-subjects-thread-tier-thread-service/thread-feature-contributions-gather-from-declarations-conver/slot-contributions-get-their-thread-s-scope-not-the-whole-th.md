---
id: 01a11b1e-7c07-78ca-8fe6-ce1247b3fe9f
title: Slot contributions get their thread's scope, not the whole ThreadSlot
ord: 3
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a11901-470f-7498-99ae-69edca82b61a
  - kind: implements
    to: 01a118f1-5f59-7eb8-856a-a0e5e4e28eab
  - kind: waits-on
    to: 01a11901-470f-7498-99ae-69ef4377a3de
---
After review round ca82b61a, slot parts (`*.composer.svelte`, `*.feed.svelte`) still receive `host: ThreadSlot` whole; about 25 components hold this type. Per [[e4e28eab]], a contribution gets its thread's scope and its own service. A thread-scope type of its own is needed; components move to it, `host` leaves the parts' props.

Done: no part takes `ThreadSlot`; typecheck and contribution tests green.
