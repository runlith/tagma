---
id: 01a126b9-6a5d-780b-8049-422205931ea8
title: Baseline migration instead of 350 and operator store translation
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79ed842e3529
  - kind: waits-on
    to: 01a126b9-6a5d-780b-8049-421edbf2cadc
  - kind: waits-on
    to: 01a126b9-6a5d-780b-8049-42210911272b
---
Build the baseline migration and the transitional translation in store opening, delete the old chain, data steps, reports, the normalizer of old forms and what is tied to migration names; rewrite the exception in the legacy rule. The worktree merges to main as soon as main is merged into it and checks pass on the resulting tail; review runs after on main, and all further spec work — only on main. The build with the baseline migration translates the operator store on first opening, and that is his single step — an ordinary update with restart. The baseline is generated from the chain head at merge time: other teams add migrations daily. Before merging, translation conditions on the live store checked by reading only, the translation itself — on store copies. Delivered merged to main; fixes of the single review round — `59dd3bd760`. Scoped translation, snapshot, mirror and shape tests passed; runtime typecheck clean. Full Store.open on a big copy with an eight-migration tail stayed unproven: probe ended with SIGINT after 57 s before opening/trace; deleting its copy refused with `filesystem answered Unknown` through the file tool, the file still lies in the implementer's scratch. That proof and measurement run in [[2d1f5572|update rehearsal]] on an APFS clone. The operator's server unchanged.
