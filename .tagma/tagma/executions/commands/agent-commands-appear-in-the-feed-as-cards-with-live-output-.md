---
id: 01a14c14-6895-75c6-80f2-47bf37a0e8a9
title: Agent commands appear in the feed as cards with live output, wait or life clocks, stop and life change, and in the thread list as a load badge
ord: 8
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-754e-7774-9bf0-abe5760fe634
  - kind: relates
    to: 01a14bc0-76ff-7aba-ae6f-ec4915d6adf4
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47c14dac7eb7
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/commands/LifeLadder.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/commands/NoOutput.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/commands/OutputTab.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/CommandMark.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/CommandSheet.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/CommandStatus.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/CommandToolRow.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/LoadBadge.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/bash.feed.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/calls.feed.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/OutputTabOpen.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/WaitStatus.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/WorkLine.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/WorkPeek.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/shared/ui/TimeLadder.svelte
---
**Value.** The operator sees what the agent just started, how long it has been going and how much is left, and intervenes right from the feed.

**How.** The `bash` call card in the thread feed; the badge on the thread row in the list.

**Behaviour.**
- A background or running command card embeds a Tagma terminal with its output: stdout and stderr in arrival order, with the same engine as the panel terminals, with search and copy. The terminal appears with the first output byte. While the program has printed nothing yet (for example `… | tail`, or output diverted to a file), the command's live processes stand in its place as a tree with CPU and memory, and a run that ended with no output gets "Printed nothing".
- While the call holds the command, the clocks show time from the wait; a command gone to background is marked "Background", its state is a square on the feed rail (green breathing while running; red after a nonzero exit), and the life measure is fill plus "4:31 of 10:00". Beside it — the program currently in the foreground, and the whole command's CPU and memory.
- A finished command shows the exit code or the reason it never started; an unconfirmed state is marked separately.
- Life changes by pressing its clock: a popover with a row of step tiles up to the ceiling, elapsed time dimmed, and one press sets a new life — longer or shorter. The same picker (`TimeLadder`) stands at the agent call's limit; there is no field for typing a time.
- Row buttons: stop or dequeue, open output as a tab beside it.
- A call line that reads or waits on an execution (`read_output`, `wait_terminal`) shows only its own wait and "Stop waiting": the command's life and stop stay on its start line. Expanded, it shows the command in the same block as the start card (first three lines with a fade, "Show all" and Copy), facts with captions, and buttons in words: "Stop waiting", "Open output", "Change life", "Stop command". The tab is the same Tagma terminal with the command output, read-only; it stands by the command's thread (if the thread is not on screen, it opens first) and lives until closed. It cannot be opened separately from the "+" menu.
- The badge in the thread list shows the thread's live command and terminal count and their CPU share. A click opens a popover beside the row with exactly those executions. It keeps one width in every state and grows only downward. Each row has two lines: the caption or command with its age, then the addresses it listens on as links, its directory, the foreground program, CPU and memory, told apart by tone and gap. With no address the second line starts at the directory and the row keeps its height. Past an hour the age reads in the thread list's compact form (`2d`), unless a wait or a life limit is running. Opening an address opens it by the link rule — beside, or the full place on ⌘-click — and closes the popover.
- The whole row opens its thing. A held terminal opens its terminal: in the panel of its place, as a tab of its holder, or, when no checkout holds its directory, as a tab of the thread holding it. A pipes command expands in place: the full command, with the output terminal beneath it when there is output (in the expanded row it appears on its own), or the command's live processes while there is none. The `>_` mark of a pipes row is dim until its first byte. On hover the age gives way to the row's acts: open its terminal, a tab with the command output, life, and stop. The popover header stops the whole thread tree in words ("Stop all") and leads to full Load. Number and lines come from one Load line, so the badge also works for a thread of another project; details come from the feed of the project commands, where it exists.

**Limits.** The card goes to the native agent's `bash`. For a command that ended before the host-logic change or in its previous generation, the host does not know whether there was output: its badge is dim, and the terminal shows.
