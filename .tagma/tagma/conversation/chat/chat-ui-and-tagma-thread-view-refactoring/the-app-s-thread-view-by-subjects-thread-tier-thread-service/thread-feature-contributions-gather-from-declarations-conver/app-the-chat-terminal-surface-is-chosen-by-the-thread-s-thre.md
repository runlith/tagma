---
id: 01a11901-470f-7498-99ae-69eba3018d1a
title: "App: the chat/terminal surface is chosen by the thread's thread.harness, not the list row"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118f1-5f59-7eb8-856a-a0e5e4e28eab
---
Per [[e4e28eab]], the "Surface adapters" part: selection by transport from the snapshot (`thread.harness`), variant branches in `Conversation.svelte` and `View.svelte.ts` go away.

Done: a terminal thread opened by URL outside the list window opens as a terminal (test).
