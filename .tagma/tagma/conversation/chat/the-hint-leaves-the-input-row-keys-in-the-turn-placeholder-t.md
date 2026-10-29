---
id: 01a15e63-7468-75bb-847e-0bbec70a2394
title: "The ↵ / ⇥ hint leaves the input row: keys in the turn placeholder, the send button with menu stands the whole turn, left chips never wrap"
ord: 60
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15c80-45a4-7400-9098-f51b45bd186d",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927c37d1b13b
sources:
  - kind: file
    ref: packages/chat-ui/src/Composer.svelte
  - kind: file
    ref: packages/chat-ui/src/composerFrame.ts
---
The "↵ next step · ⇥ after turn" hint in the row's right column steals width from the left. On the left, at widths from 30rem, chips wrap, and the field grows a row with its first letter during a turn. The send button during a turn also appears only with text. No mouse follow-up can be placed.

Make (options B2 + B3 of artifact `http://localhost:5634/a/88d93654cccd`):
- remove the hint from the row;
- while a turn runs and the field is empty, the placeholder names both keys;
- the send button stands in place the whole turn; empty means inactive; where the transport reads words mid-turn, it is split: the main part is the next step, the chevron opens the "Send at the next step ↵ / Send after this turn ⇥" menu;
- the row's left chips never wrap; what does not fit goes into a fade.
