---
id: 01a14c14-6895-75c6-80f2-47c14dac7eb7
title: "Load — a compact task manager: how much CPU and memory Tagma, its agents, and everything they started eat, and one button to stop it"
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2aaba2d4d54
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47c2848a96fa
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47c3c1a7947b
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/LoadButton.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/LoadChart.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/LoadGlance.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/LoadPanel.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/LoadRow.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/load/View.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/executions/load/list.ts
  - kind: symbol
    ref: apps/tagma/server/src/executions/contract/wire/operations/machine.ts
    symbol: MACHINE_OPERATIONS
---
**Value.** When the machine is loaded, the operator immediately sees which agent or program occupies it and stops it without opening the system monitor.

**How.** The load button in the status bar with a summary, the card on hover, and the Load panel on click; the thread row's operation popover leads to it on its line; `read_machine_load` for agents, `end_machine_process` for the operator.

**Behaviour.**
- One unit is a share of the whole machine: Tagma lines add up to its number, all lines to the machine CPU. Tagma's lines form one list: Server (with its background work and the short-lived children it reaps), Terminal host (execution host and holder), Interface, Graphics, one line per window renderer drawing built-in pages or app and MCP views — titled by what it draws ("Page — title (host)", "App — id", "MCP view") — agents, and terminals and commands without a thread. The window declares its own processes and the documents each renderer hosts, so its load is Tagma's whichever process started the server. If the reading cannot fit every Tagma group, the folded work stays in an "Other Tagma processes" line; folded server and host figures keep their roles. Sorted by CPU and not searching, lines under 0.1% of the machine over the last seconds fold into "Idle — N" at the end. Below stands the collapsed "Rest of the <machine>" with programs, the system line and small lines inside "Others"; processes the system hides from this user are read only while it is open or a search runs.
- An agent line is the whole tree of all its commands and terminals, with short descendants and what they left; each live execution has its own caption, CPU share, and memory. A program line is an app with all its helpers.
- The header: Tagma and machine CPU and memory as a whole, memory pressure, a diagram of recent minutes over the heaviest lines; lines have their own sparklines. Sort by CPU, memory, or name, search by name, page title and host, app and view names, command, and PID; a line expands into its processes. The machine is named in its system's words. A GPU column stands only while the system measures GPU for some process, an unmeasured member marked as a lower bound; with nothing measured the panel says GPU is not measured on this system and why, never showing zero. Tagma's own processes are named by their role — server, execution host, holder — not by executable name; for a process whose share includes short-lived descendants it gathered (the server's `git`), that part stands beside it as its own number, and the hint splits the share into its own and the descendants'.
- Stopping an agent line stops its commands and terminals and finishes leftover processes; a renderer line closes the built-in pages it draws; a process or program ends on rechecked identity, and the line shows the outcome: gone, left, closed, or refused.
- The status-bar button is a chart of Tagma's share against the whole machine over 2 minutes, "Tagma share/machine share" for CPU and Tagma memory. The alarm adds no words: under CPU saturation the machine share turns amber, under memory pressure the memory; without fresh readings the button pales.
- Hovering the button opens the card: what happened and the agents' share, CPU and memory scales of Tagma against the machine background, a chart in whole-machine shares, background work, and the three heaviest Tagma lines with a stop; hovering a line draws its line on the chart. Clicking the button, a line, or the card bottom opens the panel in the same popover, by line — on its thread.
- Work the server itself does for more than a few seconds — migrating thread journals to a new form, line output after commits, rule remeasuring — stands as a progress ring in the button, a block in the card, and a "Background work" group under the Server line: name, reason, "done / total", and remaining estimate. Its CPU is part of Tagma's share and is not shown separately.

**Limits.** The Tagma server, its host and window processes, and processes the user cannot signal are not finished. Without an execution host there is no load. A renderer line closes pages only: app and MCP views have no close from the server, and a renderer that also draws the interface has no act. An MCP view is named without its server, and an app by its id. A window process the host cannot match to the kernel's own process stays outside, named in the panel's hint. Compositing the system does for the window is not split per process.
