---
id: 01a15c5c-a9be-77e2-979d-c8670e5f30cc
title: The Tagma terminal opens from the host-held screen, not the byte tail; a hidden terminal is freed whole and returns to the same screen
ord: 31
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47ae7cfc3462
  - kind: relates
    to: 01a15c3b-48c4-7846-8c30-4f17497a5e13
---
## Why

On first open, reopen, reconnect and after a record break, `TerminalPane` starts from a bounded record tail (`RecordStream.tailStart`: 120 bytes per scrollback row, about 600 KB at 5000 rows). The tail holds no screen or modes the program enabled before it. A trial on `@xterm/headless` (Orca comparison, thread 01a15c45-6aaa-7991-af59-4c8744e857ff): the program enables alternate screen and bracketed paste and prints 616016 bytes; a fresh terminal receiving the last 600000 bytes stands in the normal buffer with no bracketed paste. For a human this means: vim, less, htop after reopening paint into the normal buffer over history; pasting goes with no bracketed paste, because `Pane.watch` takes the mode from the browser xterm and hands it to `TerminalInput`; cursor keys in application mode and the mouse don't work.

The host already holds everything needed. Pty interpretation keeps the screen, and `ScreenCheckpoint` (`packages/execution-host/src/ScreenCheckpoint.ts`, note [[84bfd0e6]]) writes the control codes after which a fresh engine resumes parsing into the same cells with the same state: both buffers, history, modes, kitty flags, pen, charsets, saved cursor, margins, links. There is also a `Screen` screen subscription with `ScreenProgramFrame`. The window doesn't use it: it subscribes to bytes.

Hidden terminals hold a live xterm: `TerminalViews` — up to six undisplayed panes, panel tabs — their own; `RenderPolicy` bounds only GPU contexts. Freeing a hidden terminal whole today would lose its screen. Opening from the host screen makes freeing lose nothing.

## What will stand

### 1. A pty terminal opens from the host screen

On every entry — first open, reopen, reconnect, record break — the pane receives the interpretation screen at position P and then record bytes from P. No byte is lost or repeated; resize applies by the record grid, as now.

- The screen and the byte start are one consistent pair: the screen position is the subscription start. The implementer picks the shape by existing doors: a subscription starting with a screen frame, or a point read followed by a subscription from its position. No second recovery mechanism is written next to `ScreenCheckpoint`.
- History in the screen is bounded by the window engine's scrollback.
- The engine's answers to queries while replaying the screen to the program never go out: the window already drops its own answers, that stays.
- OSC 8 links are restored as in host recovery (`relink`).
- The byte tail remains where there is no screen: interpretation refused (`screen.abandoned`) or the execution has none. The undisplayed-history line stays.

### 2. Pipes output doesn't change

The host doesn't interpret pipes output, and the Output source keeps reading the tail: it holds no modes, the pen at the tail start is reset by `BYTE_GAP_RESET`.

### 3. A hidden terminal is freed whole

A pane displayed nowhere surrenders xterm whole — DOM, WebGL, buffers, subscription — and keeps only the binding. On display it opens per item 1, Output from the tail. This covers both `TerminalViews` and panel tabs. When to free and how many terminals to keep alive is justified by the machine range ([[fe83acfa]]), not the operator's machine.

### 4. Documents

The same change fixes [[7cfc3462]] (currently "replays the record tail") and [[0c39e069]].

## Owners

- `packages/execution-host` — `Interpretation.ts`, `ScreenCheckpoint.ts`, registry: the live interpretation's screen on window request.
- `packages/executions` — the screen wire and byte subscriptions.
- `apps/tagma/server/src/executions` — `terminals/channel.ts`, `contract/wire/viewLeases.ts`, `contract/wire/feeds.ts`.
- `apps/tagma/app/src/lib/features/executions/terminal` — `Pane.svelte.ts`, `RecordStream.svelte.ts`, `Views.svelte.ts`, `RenderPolicy.ts`, `Retention.ts`; `worktrees/WorktreeTerminals.svelte.ts`.

## Acceptance

1. A pty program enabled alternate screen, bracketed paste, application cursor and mouse tracking and printed more than fits the tail. After the window reopens, the window xterm's buffer and modes match the host, pasting goes in bracketed paste.
2. Reconnect and record break resume output with no byte lost or repeated.
3. A terminal hidden past the threshold holds no xterm; shown again it stands on the same screen as the host.
4. Terminal open time with 5000 history rows measured before and after, as one sample.
5. Host, protocol, server, `executions` and `threads` typecheck and tests pass.
