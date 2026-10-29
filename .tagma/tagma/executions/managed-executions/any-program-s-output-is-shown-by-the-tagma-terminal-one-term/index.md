---
id: 01a15c3b-48c4-7846-8c30-4f17497a5e13
title: "Any program's output is shown by the Tagma terminal: one TerminalPane paints pty and pipes-program output, anywhere"
ord: 29
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47ae7cfc3462
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47bf37a0e8a9
  - kind: relates
    to: 01a15b5b-5488-75b1-82ce-0bc2572a0aa1
---
## Why

A pipes program's output — an agent command and a background program the agent holds — is currently shown by a separate window: a `pre` with a stdout / stderr / both switch (`commands/Output.svelte`, `load/OutputSheet`). The operator's decision: there is no such view anywhere; a human always sees any output in the Tagma terminal on xterm. The terminal is one component shown anywhere: in a tab, in a window, inside any interface, with no second implementation.

pipes stays the agent's transport: the model gets clean text, stdout and stderr separately, and the exit code (`agent-tools/bash/answers.ts`). Only the agent sees the transport; a human always looks at the terminal.

## What will stand

### 1. The host keeps output in arrival order

Record streams are independent: each has its own segment set and byte count (`executions/recordFormat.ts`), no order is kept between stdout and stderr. So a pipes execution's record holds a third `output` stream: every chunk read from stdout or stderr is appended to it whole, in the order the host read it. This is the best available order: two pipe descriptors share no kernel order.

- stdout and stderr stay as they are: the agent and its tools read them as now.
- `output` isn't streaming, never holds the program back, is evicted by its own storage window; a failure writing it never drops stdout and stderr capture.
- A record created before the change reads as before. A live record with no `output`, which the host reopens after the update, gets an empty `output` from reopen.
- Read doors — `read_terminal_bytes`, `read_command_bytes`, `terminal.bytes.subscribe`, `command.bytes.subscribe` — accept the `output` stream.

### 2. One terminal with two sources

`TerminalPane` takes a source when bound to an execution.

- **Shell** — pty: input over a lane, the server settles size (`ViewGrid`), Restart and take over. Today's behavior.
- **Output** — a pipes program's output: reads `output` from the terminal's or command's record, no input, no Restart and no take over, size from its own container. The program end is shown as the outcome with no Restart.

The source is binding data, not a second class: `PaneHost`, search, selection, copy, links, theme and scroll are shared.

### 3. Shown anywhere

`ThreadPanes` becomes the shared registry of off-tab terminals (`TerminalViews`): by key it hands a `TerminalPane` with `PaneGround`, holds a bounded count and closes the oldest. The thread's CLI-agent screen and built-in output terminals are its consumers. Panel tabs stay the owners of their layouts and splits.

### 4. Where it shows

- A held pipes program (the agent's background server) opens as a bottom-panel tab of its worktree, like a pty terminal: `terminalOpens` and the panel layout accept pipes.
- An agent command — a built-in terminal in the feed card where the output window stands now, and in the thread operations popover's expanded row. A background program in the popover expands with the same terminal.

### 5. Deleted

`commands/Output.svelte`, `load/OutputSheet.svelte` and the `OutputSheet` service, the Output button in `CommandActs` and the popover, the stream switch.

## Owners

- `packages/executions` — `protocol/record.ts` (`Stream`), `recordFormat.ts`, `RecordFiles.ts`.
- `packages/execution-host` — `ExecutionRecord.ts` (capture), `RecordJournal.ts`, `RecordWriter.ts`, reopen.
- `apps/tagma/server/src/executions` — `contract/wire/viewLeases.ts`, `operations/commandCatalog.ts`, `operations/terminalCatalog.ts`, byte channels.
- `apps/tagma/app/src/lib/features/executions` — `terminal/Pane.svelte.ts`, `PaneHost.svelte`, `ExitOverlay.svelte`, `ThreadPanes.svelte.ts`, `RecordStream.svelte.ts`, `worktrees/opens.ts`, `worktrees/Terminals.svelte.ts`, `commands/Output.svelte`, `load/OutputSheet*`.
- `apps/tagma/app/src/lib/features/threads` — `WorkLine.svelte`, `CommandToolRow.svelte`, `CommandActs.svelte`.

## Acceptance

1. A program alternating writes to stdout and stderr yields in `output` all its bytes in host-read order; stdout and stderr separately are the same as without the change.
2. Reopen of a live pipes record continues `output`; sealed and live records created before the change read.
3. An agent's background pipes program opens as a bottom-panel tab: the terminal shows its output in arrival order, no input, size by tab; after the end — the outcome with no Restart.
4. A background command's feed card and the popover's expanded row show output as the Tagma terminal; no stdout / stderr / both window exists in the app.
5. The thread's CLI-agent screen and panel pty terminals work as before.
6. Typecheck and the `executions`, `threads`, host and protocol tests pass.
