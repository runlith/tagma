---
id: 01a14b1b-14eb-75f6-a49c-490bb2ab8869
title: "Kit layer stack: build it and move the dialog onto it, with rectangle projection and intent signal"
ord: 16
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13d48-9aa9-71d0-a2d8-68fc313c7343
  - kind: waits-on
    to: 01a14b1b-14eb-75f6-a49c-490a2fc898d8
---
Build the [[313c7343|layer stack]]: stack and depth, closing, `place` and tracking, portal, presence, focus, scroll-lock, rectangle projection, and intent. The dialog moves onto the stack in the same change; the `dialog/content.svelte` heuristics are removed. Components on bits stay until their own tasks; don't touch their z beyond what the dialog needs.

Done when: the spec's performer checks pass, `dialog/escape.test.ts` and `dialog/focus.test.ts` are green on the stack, `bun check` is clean, commit.
