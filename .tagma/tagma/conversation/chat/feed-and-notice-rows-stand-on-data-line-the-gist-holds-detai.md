---
id: 01a17dfb-ed8a-7e10-aee9-fec32f21aee8
title: "Feed and notice rows stand on data-line: the gist holds, details leave whole, the tail stays outside"
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

So a step row, a notice row, a grouped notice and a list row in a step body stand on `data-line`. The gist is one text — the verb with its subject, detail and preview — that holds its width and fades at its end only once it stands alone. Value facts, chips and a preview after chips leave the line whole, and only the last of them fades at the line's end. In a notice row the thread chips come before the words and give way at the line's start (`data-yield="start"`), so the words stay readable while the chips fade from the left. A thread chip keeps its width up to its `max-w-60` ceiling and fades its own title inside its frame.

The tail — outcome, time, count, a hold's status — stands outside the line, so "Refused" and `exit 1` stay visible at any width. The queue reason is the row's last element: it stands on a zero basis after "Queued" and takes only the place left, fading at the row's end. A path in a list row fades from the start, the file name stays whole.

A machine row never joins the row: a command-end notice carries the label (`label` — the agent's description or the command head) apart from the full command; the row shows the label, and the command stands as the well's first line above the output tail — as in the bash step's own body.
