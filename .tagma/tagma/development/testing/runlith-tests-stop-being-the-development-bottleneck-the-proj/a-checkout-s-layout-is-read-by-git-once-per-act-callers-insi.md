---
id: 01a16e53-ca1e-79ed-b05b-ed84e599e823
title: "A checkout's layout is read by git once per act: callers inside the act receive it instead of re-reading it"
ord: 35
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ded-1e3a-73ae-9e16-b62321fe10a1",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
---
`configTightening.itest.ts`, test 1: 490 git processes over ~11 acts, 77 of them reading the layout (`rev-parse --is-bare-repository --show-prefix … --git-dir --show-toplevel`), about 7 per act, although [[064d4461]] says "once per act". Find the callers that re-read the layout inside one act and hand them the act's layout — in `packages/git` or at the callers, by owner. Git count before and after on this test.
