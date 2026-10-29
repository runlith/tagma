---
id: 01a0cf4b-e143-70f4-9a38-34e752c27ff4
title: Make the pane type through its lane and reopen a lost lane silently
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d01f-4af3-7ca0-93e1-695681797232",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0cf56-281d-7ffa-a766-934722097468
  - kind: waits-on
    to: 01a0cf4b-e140-75c1-b41d-5f5552d67932
---
Build the pane part of [[22097468]] (section 5, Pane) in `TerminalInput.ts`, `TerminalPane.svelte.ts` and `TerminalTabs.svelte.ts`: the road read from the socket before land and bind, today's road kept whole behind it, a lane-born pane reborn on today's road when it meets it (watching an agent-held terminal, taking an operator-held one), the view id sent at the lane's open, the lane opened at first focus or typing on the lane road, one silent reopen on any refusal of the lane itself, expired receipts settled as lost. The claims its section 8 names as dying or absorbed are rewritten from the built code at their owner. Done when the behaviour is covered through `TerminalInput`'s public road, the typing cases of section 7 were checked live on a build of the working tree, a reviewer on the builder's own rung found nothing left open, and doctor over the touched paths is clean.