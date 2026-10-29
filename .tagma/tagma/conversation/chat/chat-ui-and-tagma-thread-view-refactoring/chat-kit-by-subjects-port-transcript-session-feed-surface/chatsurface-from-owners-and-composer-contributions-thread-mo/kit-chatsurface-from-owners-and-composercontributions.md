---
id: 01a11901-470f-7498-99ae-69e980577970
title: "Kit: ChatSurface from owners and ComposerContributions"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118f1-5f59-7eb8-856a-a0e2e1b8ac9f
  - kind: waits-on
    to: 01a11901-470f-7498-99ae-69e618d547b2
  - kind: waits-on
    to: 01a11901-470f-7498-99ae-69e71df77ec3
---
Per [[e1b8ac9f]]: the surface contract (thread, turns, kinds, composer, memory, rendering, navigation, preferences, handle), the props-move table, `ComposerContributions` (command, chip, panel, mention provider, attachment kind), `verbose`/`stretches` by registration, thread modes as session data. `ChatSurface.svelte` under 650 lines.

Done: typecheck; the composer tests from [[e1b8ac9f]].
