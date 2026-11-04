---
id: 01a17dfb-ed8a-7e10-aee9-fec32f21aee8
title: A step row and a notice squeeze one text — the gist; unbounded details yield first
ord: 71
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a17d74-ea1a-7714-9b0e-77b6173ab5ec
sources:
  - kind: file
    ref: packages/chat-ui/src/ActivityStep.svelte
  - kind: file
    ref: packages/chat-ui/src/entries/NoticeLine.svelte
  - kind: file
    ref: packages/chat-ui/src/entries/Notices.svelte
  - kind: file
    ref: packages/chat-ui/src/entries/ThreadChip.svelte
  - kind: file
    ref: packages/chat-ui/src/entries/ToolRow.svelte
---
Flexbox splits a space shortage between squeezable neighbours in proportion to their content width. When the row's gist (event words, label, subject) and an unbounded detail (a raw command line, thread title, queue reason) stand side by side as two squeezable fields, the long detail takes almost everything: of "Command completed" next to a hundred-character command, "Co" remained.

So the row's gist is one text with a fade at the end: event, then label or subject. The unbounded detail yields first (`shrink-[1000]`, like value facts): the thread chip (`ThreadChip`, with a `max-w-60` ceiling and its own fade), the queue reason, the preview of an agent-addressed step. A grouped notice and a list row in a step body stand on `data-line` instead: the lead or path holds its width and the chips or detail after it leave whole or fade at the line's end. A preview next to a thread chip yields before the chip itself: it stands on a zero basis and grows only to its width (`flex-1 max-w-max`), so it takes only the place left after the verb, chip and tail, and the chip starts fading only once the preview is gone. Two neighbours with `shrink-[1000]` would split the shortage by width again, and a chip with a short agent name would lose letters next to a long task text. The tail — outcome, time, count — never squeezes, so "Refused" and `exit 1` stay visible at any width. A path in a list row fades from the start, the file name stays whole.

A machine row never joins the row: a command-end notice carries the label (`label` — the agent's description or the command head) apart from the full command; the row shows the label, and the command stands as the well's first line above the output tail — as in the bash step's own body.
