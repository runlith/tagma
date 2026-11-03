---
id: 01a17d74-ea1a-7714-9b0e-77b6173ab5ec
title: "A feed step's body is one kit grammar: well, file, document, words, rows, object; the view is chosen by the text's addressee"
ord: 69
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a17d65-7adb-7b72-8cdb-4f157ad14d20
sources:
  - kind: file
    ref: packages/chat-ui/src/entries/Clamp.svelte
  - kind: file
    ref: packages/chat-ui/src/entries/ToolRow.svelte
  - kind: file
    ref: packages/chat-ui/src/entries/Well.svelte
  - kind: file
    ref: packages/chat-ui/src/entries/ToolXRay.svelte
---
A step's body — what opens under a call, signal and notice — the kit assembles from one set of parts, and the producer says only what the content is (`form` display). The view is chosen by the text's addressee, not its format: model-bound text in markdown used to render in the human-answer font, and 40 lines of a command's tail filled the screen as the agent's answer.

- **Well** (`Well`) — everything a program printed or written for the model: command output, `text`, a transport signal, notice text, input and output in details. `--chat-sunken` surface, mono 12/20 dimmed; on hover — Copy and Open.
- **File** — the same well with highlight roles and line numbers. The code body (`CodeBody` of the app) holds no frame of its own: the well gives it. A code block in the agent's answer is the same surface without a frame.
- **Document** — markdown written for the reader (a page, search output, a skill, a block body, an attached document): the same well, markdown in `small` dimmed, headings no larger than text.
- **Words** — one agent's words to another (`message`), thinking, an agent's words off-transport: no frame and no left band (a band means "you are here"), `ui` size. They stand under the step the reader opened itself to read, so they show whole, with no second `Show all`.
- **Rows** — lists: one row 24 px, with graph blocks a menu-row `BlockCard`, not a framed card.
- **Object** — what the call created or opened (a browser page, an artifact page, a video): a `raised` card with frame and header.

On the rail nothing is larger than the step row: `body`-size markdown stays only for words spoken to a person (answer, message, bubble). Long text is cut by one `Clamp` on measured height (`clampFade` watches both the block and its content, so markdown drawn later also gets `Show all`; `ClampedText` is the same `Clamp` with a Copy button); there is no nested vertical scroll in the body. A call's raw input and output (`ToolXRay`) stand behind a `Details` toggle only under a readable body — a well, error, refusal, command sheet or verbose facts; a call with nothing readable opens straight onto them, since a disclosure holding only another disclosure costs a click and shows nothing. The row-height estimate (`rowEstimate`) reads the same expansion keys as the parts: an 8-row body, and whole after `Show all`. Two exceptions, both viewers with their own scroll. Diff is virtualized and holds its own height, or a long patch would build all rows at once. A command's output terminal that has output (`CommandToolRow`, shared `TerminalPane`, 0c39e069) draws the program's stream — ANSI, row redraw — which the text well cannot, and stays the place where output reads whole.
