---
id: 01a14b1b-14eb-75f6-a49c-49128beaa2fe
title: Remove bits-ui, shadcn css and tw-animate-css, rewrite the overlays module card and merge the `own-ui` worktree
ord: 23
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13d48-9aa9-71d0-a2d8-68fb74b99a0a
  - kind: waits-on
    to: 01a14b1b-14eb-75f6-a49c-4909a308a6b0
  - kind: waits-on
    to: 01a14b1b-14eb-75f6-a49c-490d16e172ad
  - kind: waits-on
    to: 01a14b1b-14eb-75f6-a49c-490f5029c4ff
  - kind: waits-on
    to: 01a14b1b-14eb-75f6-a49c-4910d4c2400d
  - kind: waits-on
    to: 01a14b1b-14eb-75f6-a49c-491126cc916f
---
Final step of the [[74b99a0a|root]] and [[826b7939|classes]]: own custom variants in `app.css`, package removal, the text of rule 8183e6ef, the body of the [[de36c9fd|overlays module card]], a run on its own instance with frames from the root acceptance, review, merge into main.

Done when: the root acceptance is performed by the performer and the worktree is merged.
