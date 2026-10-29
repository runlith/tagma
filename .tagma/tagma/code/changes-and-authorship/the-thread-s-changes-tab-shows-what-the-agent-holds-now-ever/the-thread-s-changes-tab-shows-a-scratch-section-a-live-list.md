---
id: 01a17ddd-3716-752d-91e8-9cf51348b60a
title: "The thread's Changes tab shows a Scratch section: a live list of the thread's scratch files, outside change accounting"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17da6-a2c2-7c54-9918-ca939ba03118",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/ChangesBody.svelte
---
The operator sees what the agent put in its scratch and opens any file from there as an ordinary tab. The section isn't in the change record, the `+/−` count, "No changes yet", or "All changes are committed". The server (`checkout-files`) serves a `scratch.subscribe` subscription to one thread scratch folder: newest on top, no more than the requested row count, and a total count, observation without entering subfolders. The subscription lives only while the section is expanded, and a subfolder reads with its own subscription when expanded.
