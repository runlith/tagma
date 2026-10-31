---
id: 01a14c14-6895-75c6-80f2-47b479942bc7
title: The agent reads the terminal screen as text and the bytes of its record, and waits for the execution to resolve
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47b5276a0943
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47b7039c7507
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/operations/terminalReads.ts
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/inventory.ts
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/reads.ts
---
**Value.** The agent sees what a person at that terminal would see, without parsing control sequences, and waits for the work to end with one call instead of a polling loop.

**How.** `read_terminal_screen`, `read_terminal_bytes`, `read_terminal`, `read_terminals`, `wait_terminal`.

**Behaviour.**
- The screen answers with numbered lines and the scrollback the frame still holds; on request — cells with style, but that is megabytes. As text the agent gets the header — size, cursor, buffer, input modes changed from the profile default with the profile revision, window title, frame revision, and the byte up to which it is parsed — then the screen in one block: wrapped lines joined, empty tail dropped; with cells — styles also, as column spans per line.
- Bytes are read as a window over the stream offset without consuming: another reader's position does not move, and the answer says what the record still keeps, so a gap is visible. As text the window arrives readable: UTF-8 as text with visible control characters, a character split by the window edge and invalid bytes as marks; the range and the next offset stand before the text.
- `read_terminals` answers with executions the installation still vouches for, or history; the line names the holder, the start place, listening sockets, and the host's memory count.
- Waiting is observation with a budget: its expiry does not touch the work, and the operator's words or a due report end it earlier.
- Each reading names others who typed into the execution.

**Limits.** Reading gives nothing: observing another's work does not make the agent its holder. Each call reads one project's executions; `project` selects it, defaulting to the calling thread's home.
