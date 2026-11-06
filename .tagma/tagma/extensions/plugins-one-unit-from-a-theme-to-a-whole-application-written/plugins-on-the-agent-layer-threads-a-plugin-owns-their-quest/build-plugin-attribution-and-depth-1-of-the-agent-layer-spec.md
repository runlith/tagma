---
id: 01a1b183-b6d8-731d-b86d-2904b1c0e5fa
title: Build plugin attribution and depth 1 of the agent layer (spec c4451a7e)
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1b15d-07d5-7762-ad3c-66b601e63162",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1ad4a-de84-7ddc-9396-cf6ac4451a7e
---
Build the parts of `c4451a7e` its order of work places before step 5 of `d2b5f488`: the caller parsed once at admission with the project-enabled check, the server-written `bindings.plugin`, the recorded turn sender, own-thread control acts, questions routed to the plugin with `leave()`, the model menu read, and `ask_model`. Depth 2 and 3 wait for the window's module host.