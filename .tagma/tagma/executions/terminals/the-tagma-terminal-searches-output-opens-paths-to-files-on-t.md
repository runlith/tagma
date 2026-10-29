---
id: 01a14c14-6895-75c6-80f2-47af5283a9d6
title: The Tagma terminal searches output, opens paths to files on the right line, takes dragged files, and follows the chosen clipboard and keyboard rules
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046371947f5b
  - kind: relates
    to: 01a14c08-619e-7ae1-af8b-16c009901e65
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47b0b84c2d57
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/ContextMenu.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/Input.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/Keymap.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/links.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/Search.svelte
  - kind: file
    ref: apps/tagma/server/src/executions/contract/wire/terminalBehavior.ts
---
**Value.** The terminal in the Tagma window behaves like a familiar emulator, and agent or build output leads straight to the file and line.

**How.** Search, context menu, and panel keys; the Use card keys in Settings → Terminal.

**Behaviour.**
- Output links obey the window's shared link rule. A `file:line:column` path or an OSC 8 link to a file (a picture embedded in a TUI thread), if such a file exists, opens on that line with a click as a file tab in the right area of the screen, with ⌘-click — in Files; an http(s) link opens on click in the built-in browser beside it per `browser.openLinks`, with ⌘-click — in the system one. Opening beside does not steal focus from the terminal, so a double click on a path opens it and then selects it.
- While the program switched mouse tracking on (vim, htop, agent TUIs), a plain click belongs to it, and only a ⌘-click opens the link — with what a click usually does. A click that only moves focus into the panel does not open a link. The line at the panel bottom on hover says what will open and where each gesture leads.
- A file dragged into the panel or onto its header is pasted as a path.
- Copy on select, right-click paste, program clipboard writes via OSC 52 (clipboard reading is disabled), pointer hiding while typing, and focus-follows-pointer are each switched on by their own key.
- The key policy decides who wins on clashing combinations: the Tagma app or the program in the terminal. On macOS Option works as Meta by layout, always, one side, or never.
- Wheel sensitivity is set separately for plain scrolling, fast scrolling, and a fullscreen program; a separate key sets the word-boundary characters for double click.

**Limits.** Paths resolve relative to the place root. Voice input in the terminal is a speech feature; links in the built-in browser are a web feature.
