---
id: 01a189d1-ec6c-7b50-9a58-85bcd8257afd
title: Titles, recaps and thread decisions ask their model as a background thread, and the wire, aside and one-shot CLI calls beside the thread engine are removed
ord: 99
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a11127-7009-727d-9639-b5f1db7ababc
  - kind: relates
    to: 01a189d1-58cf-7a28-b84e-4bb4320bb563
  - kind: waits-on
    to: 01a189cf-911d-7f0f-bd39-03cc0ca4dfa0
---
Rule 320bb563 makes every model call a thread run through the one thread mechanism. Today these call a model beside it:
- the fresh title (`threads/naming/excerpt.ts`: a wire request, or the Claude Code `claude -p` one-shot of `external-harnesses/vendors/claude-code/row.ts`);
- the warm title and the manual recap (`threads/naming/generate.ts`, `threads/recap/questions.ts`: a side question over the thread's captured request, else a wire request);
- thread decisions (`threads/decisions.ts` with `DecisionModels` in `providers/decisions.ts`).

Each becomes a background thread started through the one entry point with its own arguments — not shown, no title, a short prompt or none, no tools — on a selection made with the thread's own model picker, so every model a thread runs on serves it. The chain of `threads/roads.ts` then has nothing left to choose and goes with the one-shot launch declaration. Correct explanations db7ababc, 2fa8d937 and db0541d5 in the same work. The cheapness the warm side question bought (an answer over an already cached prefix) is kept only if the thread mechanism itself offers it, e.g. a background thread forked from the asking thread's history, not by a second call path.