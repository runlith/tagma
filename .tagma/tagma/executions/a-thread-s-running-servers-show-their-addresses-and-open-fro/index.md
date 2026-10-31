---
id: 01a19420-92b3-74b1-b0e9-37b06636131b
title: A thread's running servers show their addresses and open from the thread row
ord: 52
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47bf37a0e8a9
  - kind: relates
    to: 01a19414-3450-7586-b2b1-a1510f6f108c
---
**Outcome.** Every held terminal or command a thread runs appears in the thread row's popover with the addresses it listens on, as links. Each opens its terminal in one click, wherever it was started. The popover keeps one size.

**Why.** Seen on 2026-10-31: an agent had held two dev servers for 48 h — demo on `*:5193`, site on `[::1]:5173`. The popover showed neither address and offered no way to open them; stop was the only act. Three roots:

1. **Ports never reach a terminal row.** The host's namespace listener inventory (`ProcessEvidence.inventory`, the `ListenerInventory` answer) carries sockets without `association`. The server's terminal inventory (`terminals/inventory.ts`, `terminals/reads.ts`) and `servedRoots.ts` assign sockets to terminals by that association. So every row reads `listeners: []`: in the popover, in `read_terminals`, and in the built-in browser's serving-root lookup. The per-execution `listeners` reading does associate.
2. **A terminal started outside its thread's home project has no place.** It is recorded in the home project without a `rootId`. The app opens only placed terminals (`terminalOpens`), and the terminal panel shows unplaced rows nowhere.
3. **The popover itself (`WorkPeek`, `WorkLine`):**
   - its width flips from 320 to 480 px when a row expands;
   - a click expands the row instead of opening it, and a pty row expands to a bare command line;
   - the clock ticks seconds on a two-day server;
   - a hollow square reads as a checkbox;
   - values are split by `·`, and the port link is drawn in `--status-open`;
   - opening a link leaves the popover open.

**Decisions.**
- The host owns which execution holds a socket. The namespace inventory associates each socket by kernel tables (rule 62049465), using the same relations as the per-execution reading over one process-table scan per reading. The consumers stay as written.
- An omitted `project` on a terminal operation resolves from its `cwd`, like any path a call names (the `projectField` contract). A terminal then lands in the project and root of the checkout that holds its directory.
- Opening a held terminal never depends on its place. An unplaced one, whose directory lies in no registered checkout, opens as a tab of its holder thread.
- **Popover layout and acts.**
  - One width in every state: the current expanded width. The popover grows only downward.
  - A row has two lines. The first holds the title and the age. The second holds the port links (mono, `arrow-up-right`), then the directory (`PathText`), then CPU and memory in a muted tone. Neighbours are told apart by tone and gap.
  - A click on a pty row opens its terminal. A click on a pipes row expands its output in place, as now.
  - On hover, open-terminal and stop float over the row's end, taking the age's place.
  - Past one hour the age takes the thread list's compact form (`2d`). Seconds show only under an hour or under a life limit.
  - "Stop all" is written in words. A row's stop is `circle-stop`.
  - Opening a link closes the popover (`onLinkOpened`).

**Acceptance.**
- A held terminal listening on a local TCP port shows that port in `read_terminals` `listeners` and in its popover row within one inventory reading. A host itest asserts that a socket in the namespace inventory carries its execution's association.
- `servedRoots` resolves a localhost origin served by a held terminal to that terminal's `cwd`.
- `start_terminal` from a thread homed in project A, with `cwd` in project B's checkout, records the terminal in B under B's root. The popover offers to open it.
- An unplaced held terminal opens as a tab of its holder thread.
- The popover's width does not change on expansion, on hover or with its content. Feature 37a0e8a9 describes the new behaviour.

Mockup: the hosted page "Running servers popover" (artifact 77a14063c041).
