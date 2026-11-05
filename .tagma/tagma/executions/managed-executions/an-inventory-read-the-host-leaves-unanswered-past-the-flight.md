---
id: 01a1a911-2415-7bf1-9b4b-46f158a23300
title: An inventory read the host leaves unanswered past the flight's ceiling refuses as TerminalUnavailable, never as a defect
ord: 109
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/commands/feed.ts
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/inventory.ts
---
The inventory serializes every catch-up with the host behind one flight, and a catch-up is a host request: when the host's request lane is saturated, the holder waits and the readers behind it reach the flight's wait or hold ceiling. That is an expected outcome, not a server bug, so it reaches readers as `TerminalUnavailable` from the host.

As a defect it did lasting damage: the commands feed failed its readers with it and the live socket ended the client's whole connection — every subscription of the window, not only commands — and the `terminal-disposition` driver stopped for the rest of the server's life. A typed refusal is handled where it lands: the commands feed composes that round whole and reads the moves again at the next one, without ending a view — the window reopens a failed live subscription only on a new connection; the disposition pass skips one round; a refresh leaves its cells stale. A catch-up the ceiling cut, or any interrupted one, leaves the mirror unsynchronized, so the next reading asks the host instead of trusting a mirror a half-applied reading may have left behind.
