---
id: 01a17174-52b1-7a00-a88a-c5dc08908298
title: An image path is pasted without quotes, as a separate paste, and a typed space separates neighbouring paths
ord: 15
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/pathInput.ts
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/executions/terminal/Input.ts
    symbol: TerminalInput.pasteEach
---
Claude Code and Codex attach a picture only when the paste reads as a bare path to an existing file. Claude Code strips just one outer pair of quotes, so `'…'\''…'` is no longer a path to it, and Codex splits a raw path on ASCII whitespace. So an image path (by extension) goes as is, while characters the shell would split on get a backslash. The set of such characters differs for posix and for fish: fish does not know `` \` `` and `\!`, while a posix shell accepts a backslash before any character. The narrow space U+202F from macOS screenshot names stays as is: shells do not split on it. Other paths keep single quotes: that reads easier for both model and person.

Each path is its own bracketed-paste frame, when the program enabled it, and all of it is one input operation with one lifetime. The space between paths is typed outside the frames, including between two pictures. Orca drops it there, treating frames as self-delimiting, but zsh also enables bracketed paste and would glue two paths into one. Without the enabled mode everything goes as typed: the same form is a correct shell word.

A path with a control character is not pasted and is named in the terminal message. Inside a frame a newline would become CR, that is message sending in a TUI, and ESC would break the frame.
