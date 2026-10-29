---
id: 01a15574-4766-715f-86fe-98b6566e49ba
title: The editor launches with its own CLI from the bundle with the checkout as the project, deep link is only the fallback path, and the launched process is released before waiting for exit
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/editors/contract/wire/catalog.ts
  - kind: file
    ref: apps/tagma/server/src/editors/installed.ts
---
The editor's CLI (`code <root> -g file:line`, `zed <root> file:line`, `open -na <app> --args <root> --line N file` for JetBrains) opens the file in a window where the checkout's root is already open, or in a new window with that root. A deep link (`vscode://file…`) opens the file in the editor's last window, whatever project it holds, so it is used only when the found app has no CLI from the catalog.

Launching releases the child process (`unref`) before waiting for its exit. Otherwise closing the Effect-spawner scope after exit code 0 kills that child's whole process group, and a CLI that launched the editor first may have left the editor itself in it.

Search runs at server start, and `read_editors` then always answers from memory with the last answer and waits for search only until the first answer: an answer older than five minutes (thirty seconds after a total search failure) and a launch refusal only start a new background search, one for all readers. So a window opened later gets the chosen editor with no LaunchServices wait.
