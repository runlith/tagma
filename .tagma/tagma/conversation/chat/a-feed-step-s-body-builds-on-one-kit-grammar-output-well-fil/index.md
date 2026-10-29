---
id: 01a17d65-7adb-7b72-8cdb-4f157ad14d20
title: "A feed step's body builds on one kit grammar: output well, file, document, words, rows, object"
ord: 68
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17d50-35e2-7399-a78b-e6989933630b",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/chat-ui/src/ActivityStep.svelte
  - kind: file
    ref: packages/chat-ui/src/entries/ToolRow.svelte
---
On 2026-10-27 the operator picked option A from the "Feed step bodies" review (artifact e4ecf64cd281). A step's body — what opens under a call, signal or notice — was drawn by over fifteen code places, each with its own frame, font, color, height limit and "show more" button. Model text in markdown looked like a human answer: a background command's end opened as 14 px markdown in the primary color with a left band.

What gets built:
- the `packages/chat-ui` kit owns the body parts: output well (sunken, mono 12/20, dimmed), file (the same well with highlight roles and numbers), document (markdown at entry scale 12/20), words (13/20 with no frame or band), rows (menu-row grammar), object (`raised` card); the producer says what the content is, the kit decides the view;
- on the rail nothing is larger or brighter than the step row; large primary text only for words spoken to a person;
- one cut of long text — on measured height (`clampFade`), "Show all" expands in place, no nested vertical scrolls in the step body; Copy and Open on the body — on hover;
- the left band on a message to an agent and a transport signal goes away;
- a refusal shows the reason once; the agent text — in details;
- a background-left command's end is a `command-ending` notice with structure, and the feed row and body from it;
- the "·" between values in notice, dock and counter rows goes away.
