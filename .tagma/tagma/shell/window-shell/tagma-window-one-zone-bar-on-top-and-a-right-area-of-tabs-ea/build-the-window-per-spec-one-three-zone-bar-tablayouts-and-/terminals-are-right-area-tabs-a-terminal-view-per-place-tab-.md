---
id: 01a15644-1d84-7417-b2e0-1a158d1f8bb4
title: "Terminals are right-area tabs: a `terminal` view per place tab, the bottom `TerminalPanel` goes away"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15644-dbd6-7ee5-a95d-35fc1e009289",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15622-e2ef-7840-b59b-5e32e200e09f
---
Part of [[e200e09f]]: the `terminal` view by place tab (id is the place tab key), place keys act on the terminal tab, reopen from "+" and by key, closing a tab does not stop the process, the agent's shell lands in the background in its holder thread's layout, `launchedFor` never becomes a tab, `?terminal=` opens a tab, shell autostart from "+ → Terminal" and the zone-B tool, counter on the tool, "New terminal" palette. Proof is typecheck, the owner tests (closing a tab does not stop the run; reopen raises the place with splits), deleted `Panel.svelte` and `Toggle.svelte`.
