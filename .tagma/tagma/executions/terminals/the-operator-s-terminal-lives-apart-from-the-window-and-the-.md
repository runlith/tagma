---
id: 01a14c14-6895-75c6-80f2-47ae7cfc3462
title: "The operator's terminal lives apart from the window and the server: closing the window, reloading, and restarting the server do not stop it, and the panel shows its history"
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee4cea7d76f8
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47c97b9b56cc
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/ExitOverlay.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/Pane.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/RecordStream.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/lanes.ts
  - kind: symbol
    ref: apps/tagma/server/src/executions/contract/wire/operations/lanes.ts
    symbol: LANE_OPERATIONS
---
**Value.** A long build, REPL, or dev server in the terminal does not die with the Tagma window or server: returning, the operator finds the same process and its output.

**How.** On its own: the panel terminal is a held execution on the execution host; the window reads its history from the record via the server, and types and receives live output over a direct connection to the host.

**Behaviour.**
- An open panel stands on the screen held by the host's interpretation: both buffers, modes — alternate screen, bracketed paste, cursor keys, mouse, kitty — and the history within the window engine's scroll limit — and continues with the record bytes from the position that screen was taken at. This is how first opening, reopening, and a record break open: vim or htop stay in their buffer, and pasting goes into bracketed paste.
- Where there is no screen — the interpretation refused a screen, the execution runs on pipes, or the host predates this door — the panel replays the record tail. Older history it then names with a line about how much more the record keeps, and a chunk dropped from storage with a line about the break.
- A terminal shown nowhere holds the engine while the window's hidden engines together fit the shared memory budget. Past it, the longest-hidden gives up the engine entirely and on showing stands on the host's screen again.
- Operator input travels its own lane past the server: keystrokes are ordered, get the host's receipt, and are never repeated. The window survives a connection break on its own, without losing keystrokes, including through a remote door. If the lane is closed or its address no longer answers — for example after handover to new host logic — the window opens a new one via the server itself. If the fate of some keystrokes is unknown, the window names the lost ones and everything typed after them in one line; otherwise the not-yet-sent input goes down the new lane. No extra key or focus is needed for this. The final end of input triggers a reread of the execution state.
- Live output comes over the same connection, and while it is absent — by record subscription via the server; a source change and a connection loss continue the show from the last shown byte, with no gaps or repeats.
- The window parses a subscription or read refusal on its own, without buttons: it rereads the execution state. A finished execution the window reads to the end from the record and shows its outcome, and a running one it resubscribes with a pause growing to 30 s. While the stream is down, a short "Reconnecting…" mark stands in the corner, and it does not cover the contents.
- The process end shows as a line under the terminal: outcome, Restart, which raises a new shell in the same directory, and Close. Restart also works before the window engine loads: starting a shell does not depend on its rendering. The terminal line stays fully visible.
- A failure of the window itself — the engine did not load, take over did not resolve — the terminal names in one corner line, without codes or instructions.

**Limits.** What the host itself survives and where it is, its own record describes; without it there are no terminals. History lives within the host memory share and may be taken from a long-idle terminal. An open-from-screen terminal shows no more history than the host's interpretation holds, even if the window scroll is longer. A terminal that gave up the engine sees no calls, title or directory changes until shown; the tab learns of its process end from the terminal list.
