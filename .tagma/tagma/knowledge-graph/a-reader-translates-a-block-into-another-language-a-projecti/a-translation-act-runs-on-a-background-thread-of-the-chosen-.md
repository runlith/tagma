---
id: 01a189cf-911d-7f0f-bd39-03cc0ca4dfa0
title: A translation act runs on a background thread of the chosen model, and the lens picks that model with the thread's own model picker
ord: 3
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a188b6-199d-7ef5-9da5-32671d5f53a4
---
The operator found the lens offering `claude-code:claude-haiku-5-5` and the act refusing it: "No installed adapter provides claude-code". Root: the act calls a model through the wire (`ModelAccess.request`), which reaches only API providers, while the lens lists every text model of the catalog — a second list beside the thread picker, with models it cannot call. The operator's decision: the choice is the thread's, one to one, and the act is a thread launched in the background. Rework the server act and the lens to the spec's current Architecture and acceptance 8–9; remove what becomes unused.