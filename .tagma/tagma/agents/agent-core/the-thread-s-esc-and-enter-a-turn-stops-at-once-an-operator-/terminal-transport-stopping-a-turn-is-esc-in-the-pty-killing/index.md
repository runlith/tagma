---
id: 01a15eeb-6b48-7ca8-9c93-24d8d0f5ca7e
title: "Terminal transport: stopping a turn is Esc in the PTY, killing the process is a separate act"
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/external-harnesses/sessions
  - kind: dir
    ref: apps/tagma/server/src/external-harnesses/terminal
---
With a terminal agent Tagma works as a human would in its TUI. Interrupting a turn is Esc in the terminal. Killing the process is a separate act, from the process list.

## What stands

- **A stop kills the process.** A terminal thread's stop from Tagma (the Stop button or Esc in the chat above the journal, another agent's `stop_agent`, Stop in the thread-list menu) travels `terminal/runs.ts:248` → `SessionDriver.stop` → `stopExecution` (`sessions/drive.ts:309,451-466`) → `terminals.stop(…, 'explicit-stop', 'signal')`. The host kills the CLI process with signals.
  - The CLI's background tasks and its queue die with the process.
  - The next word restarts the CLI.
- **Interruption print exists but is unwired.** The `interruptHarness` function (`sessions/keyboard.ts:358`) is ready and called nowhere.
- **Silent success.** When the turn is missing from this server's `OpenRuns` (after a restart before adopt, in the window between a hook event and the record), `interrupt` silently answers success (`runs.ts:251`).
- **Unbounded stop wait.** It awaits the session fiber together with transcript reading (`drive.ts:310-311`).
- **A mid-turn word awaits the turn end.** It is not printed in the TUI: `deliver` and `queued` only arm a timer (`runs.ts:75-77`). The word leaves on a Stop hook or after a 60 s silence window (`QUIET_WINDOW_MS`, `decide.ts:6`).
- **Lane printing is not serialized** (`sessions/lanes.ts`). Per the read audit, two simultaneous prints produce `input-conflict`, and the run ends `failed`.

## What will stand

- **Interruption is the CLI's interrupt key in the PTY.** The terminal transport's `interrupt` prints it through the host's input lane: Esc for Claude Code and Codex; the key is declared by the CLI profile.
  - The receipt is the interrupt bytes recorded in the PTY; on it the core writes the turn end.
  - The CLI's own confirmation — the turn-end hook, an interruption marker in the transcript, or a screen with a prompt — is a later fact. On it the TUI reads as ready for the next word.
- **Killing the process is a separate act** of the host's terminal and processes; a turn stop never calls it. Archive and thread deletion free the process with their own `release`, as now ([[e35a759f]]).
- **No silent success.** A turn with no record in `OpenRuns` interrupts the thread's session found by facet; with no session the answer is `no-turn`.
- **A mid-turn word** prints in the TUI at once if the CLI profile declares it accepts input during a turn. Otherwise the profile declares `steer: none`, and the client shows from that declaration that the word will leave after the turn. Each profile's declaration is confirmed by probing.
- **One print queue per lane.** The screen check runs in the same act as the write.

## Acceptance

A stest on a fake CLI in a PTY:
- a stop writes the interrupt bytes and does not touch the process; the process lives, and the next word prints without a fresh launch;
- a turn after a server restart before adopt is interrupted;
- two simultaneous prints do not conflict.
