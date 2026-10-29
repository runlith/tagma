---
id: 01a141b4-e078-7dad-87e4-449d9a503b63
title: "The agent terminal: input arrives one write late, screen reading loses spaces"
ord: 93
tags: ["task"]
fields:
  {
    "holder": "tagma:01a141b5-0314-7273-adb4-19360cc0ba98",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/writers.ts
---
Two defects of the agent-driven terminal (`start_terminal` / `write_terminal` / `read_terminal_screen`), found while driving Claude Code in the terminal for a polygon.

**1. Input reaches the program one write late.** Reproduction on a bare `cat` (pty, held): `write_terminal` with `hello\r` — receipt `acceptedThrough: 6`, no output (`durableThrough: 0`). The next `x` write shows `hello` twice on screen (the echo and cat's output), and `x` isn't seen. Every write reaches the child only when the next one arrives. With Claude Code the same: an arrow/Enter applies on the next press. The operator's input from the app passes through, apparently because the app also sends focus/resize, pushing the stuck one through.

Start at the input path: `apps/tagma/server/src/executions/terminals/writers.ts` and execution host (`packages/execution-host`).

**2. `read_terminal_screen` loses spaces.** Claude Code draws gaps by shifting the cursor; screen reading gives `WelcometoClaudeCode`, `Choosethetextstyle…`, though some rows of the same screen read with spaces. An empty cell the cursor passed should read as a space.

**Defect 1 result: not confirmed, no code changed.** The lag came from the caller: `write_terminal`, `wait_terminal` and `read_terminal_screen` ran in one parallel block, so the screen was read before the write was accepted. In thread 01a125fe writes #8778–#8780 started at 22:33:33.865, the screen answered at 33.978, and the write at 33.994, for example. Every screen showed the previous keypress, and the last Enter applied to "No, exit". A probe on a perl stamp printing input arrival time: the child got the bytes 30 ms before the `write_terminal` answer. Sequential writes and reads on `cat` and on a clean Claude Code (a `tagma:try` instance) show every keypress at once. The contract already holds `packages/execution-host/src/ExecutionTerminal.itest.ts` ("carries typed bytes to a real shell…").

**Defect 2 fixed in 13e83a75bc.** The root is `copyText` in `packages/execution-host/src/ScreenMirror.ts`: it glued `getChars()` by cells, and an empty cell gives `''`. Now `translateToString` assembles the row. The same cell-text output, `screenRowText` in `packages/executions/src/protocol/presentationText.ts`, is fixed by the same rule: a cell wider than 0 with no symbol reads as a space.

**Done when:** on `cat` after one `hello\r` write the screen shows `hello` at once; the Claude Code screen (`CLAUDE_CONFIG_DIR=/opt/workspaces/.claude-classic claude` in an empty folder) reads with spaces and reacts to every keypress at once. Both cases are closed by a contract test on their own tier.
