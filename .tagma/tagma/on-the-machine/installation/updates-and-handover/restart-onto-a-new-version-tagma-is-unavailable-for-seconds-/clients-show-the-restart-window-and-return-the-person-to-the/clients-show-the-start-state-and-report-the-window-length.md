---
id: 01a126b9-6a5d-780b-8049-4228220321a5
title: Clients show the start state and report the window length
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a127c9-0c53-7b65-addc-4925a82ea429",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79ebd801f443
  - kind: waits-on
    to: 01a126b9-6a5d-780b-8049-421f153b89de
---
The second part of the client spec that needs the server: showing the restart with phase and step, a failed start in the desktop window and in the browser, the window length from the client in the restart record, waiting CLI verbs reading the start state. Start with `apps/tagma/app/src/lib/app/chrome/Standing.svelte.ts`, `apps/tagma/desktop/src/waitingPage.ts`, `cli/door.ts`. Done when the browser check from the spec passes.
