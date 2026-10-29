---
id: 01a15c49-6c0d-7317-893d-d54d0c39e069
title: "One TerminalPane shows the terminal anywhere: PaneGround gives the place, Shell or Output the binding source"
ord: 17
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47ae7cfc3462
  - kind: relates
    to: 01a15c3b-48c4-7846-8c30-4f17497a5e13
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/commands/NoOutput.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/Input.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/Pane.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/PaneHost.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/RenderPolicy.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/terminalEngine.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/View.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/Views.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/CommandToolRow.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/WorkLine.svelte
---
The Tagma terminal is one `TerminalPane`, shown anywhere in the interface: in a panel tab, in a thread, in a feed card, in a popover, in a window. What depends on the place — visibility, focus, size ceiling, what tab keys do, closing — the host passes through the `PaneGround` port. `PaneHost` paints the pane into any container, carries it between containers and wires up the engine styles itself, so a new place repeats not a line of terminal code. One window IntersectionObserver reports each place's actual visibility: a card outside the feed viewport and a hidden saved tab don't count as shown. A visibility change moves no DOM and reconnects no place.

Hosts come in two kinds. A tab (`Tab`) owns its panes and their layout. Everything shown outside tabs takes a pane from the shared `TerminalViews` registry by key through `terminal/View.svelte`. Each place, while mounted, holds its pane by lease (`lease`). The registry evicts only panes with no lease and no display place, oldest first; the bound is also checked after leases are freed, once places had time to detach. A mounted place never loses its terminal, and a departed one leaves its binding for the next display while it fits the cache. One pane may stand in several places at once. It is seen in the last one arrived, and when that place leaves, the pane returns to the previous still-mounted one: the feed card gets the terminal back when the popover closes. Closing an end card in such a place hides only it; the outcome itself stays in the pane.

A pane visible in no place — its last place left, the tab is hidden, or its split was closed by expanding another of the tab's panes — joins the window-wide hidden set (`TerminalRenderPolicy`, next to hidden GPU-context retention); a never-yet-shown pane opens no engine at all. The set holds engines while their buffers jointly fit the budget: cell and row capacity is reserved together with headroom for the string cache, while combined cells, extended attrs and OSC 8 are counted incrementally by xterm itself, the same mechanism as the host's headless engine. These are buffer accounting units, not an RSS or GPU-memory measurement. The set is re-narrowed after output parsing, scrollback changes and grid without walking history; past the budget the longest-hidden pane surrenders xterm whole — DOM, WebGL, buffers, subscription, input lane, grid and watchdog — and keeps the binding and place observation. Shown again, it reopens from scratch: pty from the host screen, Output from the tail, so freeing loses nothing. The budget is buffer bytes, not terminal count: one engine with 50,000 scrollback rows at 320 columns weighs more than a dozen ordinary ones, and a counter would miss it. Browser and mobile bounds sit below desktop: a browser tab may be a remote door on a small phone. For the 1 GB-and-up design range they allot hidden-terminal buffers under two percent of memory, and the desktop bound under one percent of 8 GB; these are conservative budgets, not a reading of the device's free memory. An engine exceeding the whole budget alone is surrendered at once. With no engine a pane sees no rings, headers or the directory; a tab pane learns of the process end from the terminal list. GPU retention is also counted per pane, not per split group: closing or parking drops its entry, and a vanished place holds no project through the hidden-owners list.

What a pane shows is decided by the binding source, not a separate class. Shell is pty: input over a lane, the server settles size, Restart and take over. Output is the pipes-program record's `output` stream, where the host keeps stdout and stderr in read order. With Output, input only observes: command keys — search, copy, scroll — work, typing goes nowhere. While input is unavailable — with Output and after shell end — the cursor stays hidden, focused or not; commands from the output cannot show it. Size is taken from the container, a bare LF the engine translates to CRLF since the tty never translated it, and the end is shown as the outcome with no Restart. For a record sealed before `output` existed, the host refuses with `terminal-host-refused-StreamMissing`, and the terminal shows its stdout, then stderr under a line saying their order wasn't kept: the order between the two streams of such a record can't be recovered. There is no second terminal implementation for output, nor should there be: the stdout/stderr-switch output window was deleted by the operator's decision.

A command row — the feed call card (`CommandToolRow`) and the thread operations popover row (`WorkLine`) — mounts the Output terminal only once the host said the record holds at least one `output` byte; in an already expanded row it appears on its own with that byte. Otherwise a `… | tail` command would hold an empty black rectangle on screen for minutes, with no telling whether work goes on. Before the first byte, the terminal's place in its frame holds the command's live-process tree (`NoOutput`): the command, machine-share CPU and each one's memory, the current process highlighted, six rows and "+N more". The frame height follows the process count, so it changes with the first byte. Processes come from the machine load measurement (`Readings`): the host hands every live execution's process with its key and parent, so no new measurement is needed for the row. The measurement subscription is held by whoever displays it, while displayed: the live command frame, collapsed-row figures, thread load badge, Load button. All share one subscription (`Readings.hold`), closing with the last one gone. Otherwise a shell with no status row (mobile) would show "unmeasured" at every silent command. Until that measurement exists, the frame says CPU and memory are unmeasured instead of drawing zero. If the measurement exists but the host didn't read the execution's processes (the group ran out of frame budget), the frame says exactly that. In both cases it shows the current process from the command feed with "—" for figures. The tree is built only in an expanded silent row, not on every measurement read. A command that ended with no byte at all shows one "Printed nothing" row. The marker (`printed`) is a live read of the record on the host, like usage: it is carried by the command inventory row and the execution summary, from which the terminal-list row for a held pipes program takes it; the host store holds no column for it. With the first byte the host bumps the inventory revision once, so the command feed learns of output at once, not on the next measurement. The window reads no bytes for the marker. A record the host logic doesn't hold (the command ended before the logic change or in an older generation) has no marker, and the terminal doesn't hide: "unknown" doesn't mean "empty". The popover row's `>_` icon brightens only on `printed: true`; pty rows don't change — they have no built-in terminal, they open in the panel.
