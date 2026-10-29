---
id: 01a13cca-54f6-7dc4-93b7-dc64546c446a
title: "\"Quit\" stops only its own idle server, \"Stop Tagma\" always; both go through tagma quit of the release the window carries"
ord: 9
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/desktop/src/leaving.ts
  - kind: file
    ref: apps/tagma/desktop/src/quitting.ts
---
“Quit” (Cmd+Q and Dock) stops Tagma entirely only when nothing is working: no agents in work, no terminals or commands in the execution host, no call recording (`server.calls`). Only the server whose `/health` named the window's data directory stops; a window on a fixed address offers no stopping and on Cmd+Q only closes. When work is in progress, the server is busy installing or handing over the location, the machine state could not be read, or the server names no `calls` or executions (`host.holds`), only the window closes: stopping mid-call or mid-agent loses work, while a spare open window costs nothing.

“Stop Tagma” in the app and Dock menus names what will stop — agents, terminals and commands, call recording, the Claude Code and Codex link to Tagma — and stops everything. Both stops go as one act: `tagma quit` of the release the window itself carries (`current` 0.1.x has no such verb), and for a build without its own release — `current`; the same leaving as in `switch` — the server leaves on signal, then the execution host finishes with everything it holds. When nothing is working, `quit` answers success.

On a system command (shutdown, restart, logout) the window does not hold and asks nothing.
