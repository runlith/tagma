---
id: 01a14bae-6720-7d62-897a-928db50ae262
title: Claude Code, Codex, Grok Build, Devin, Cursor, Gemini, and OpenCode run as Tagma threads in their own terminal
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927ef2dc414b
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927fda029bcc
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928e44dc7c58
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928f4a7de7db
  - kind: relates
    to: 01a14bae-6720-7d62-897a-929026c9986a
  - kind: supersedes
    to: 01a14b6d-b24b-77f7-a09d-54ddb2ce2570
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/launch.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/birth/installed.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/contract/wire/hooks.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/installs/mcpDeclaration.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/installs/targets.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/settings.ts
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/birth/seat.ts
    symbol: terminalCapabilities
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/contract/service/table.ts
    symbol: HARNESSES
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/contract/wire/operations.ts
    symbol: HARNESS_OPERATIONS
---
**Value.** The operator keeps Claude Code, Codex, Grok Build, Devin, Cursor, Gemini, and OpenCode in one team with native agents: someone else's CLI stands in the list, obeys the approval mode and the project law, can be a child, and reports.

**How.** The `harness:<cli>` type (`harness:claude-code` for Claude Code) when opening a thread or in `spawn_agent`; a type is offered in the "+" menu's "CLI agents" section when the CLI is found on the machine; an unfound CLI whose adapter declared an install command is installed from the Tagma terminal menu. Finding and refreshing the list checks files and execute permission without launching a CLI: a found path does not yet prove it works, the version is unknown until an addressed check of the chosen program, and it expires when the file or PATH changes. The thread row carries the CLI sign, the model, and the terminal sign.

**Behaviour.** A server start refreshes integration files without launching anyone else's CLIs; approval MCP declared by the adapter runs before the chosen CLI launches, even when the declaration file is already current. Tagma launches the CLI in its terminal and installs hooks, a skill, and an MCP server with the thread's powers into it: through them the CLI calls Tagma operations on the thread's behalf, its calls are judged by the thread's mode, a mode question about a CLI-child call goes to its parent, at the first prompt and when touching files it gets the law of the touched places, and file writes enter the authorship accounting. The operator's words arrive as keyboard input; the CLI's own questions are read from the screen where the adapter declared their recognition. The operator answers them in the TUI itself: Tagma draws no form of its own over the terminal, and a recognized question of a CLI child is received and answered by its parent. A button in the thread header switches the thread between terminal and chat over the journal; the choice stays with this thread until the window closes, and the `threads.terminalChat` setting only sets the default view. Rewind and Branch stand on chat turns where the transport declared history. A transient execution-read failure needs no manual retry: the screen returns when the connection recovers or a fresh host answer arrives in the live feed, keeping the already shown terminal.

A word arriving mid-turn is read by Claude Code and Codex at the step boundary, and by Cursor, Devin, and Grok after the turn. Stopping a turn is the CLI's interrupt key; the process stays. Text the operator left in the TUI input field is not wiped by Tagma and nothing is printed over it: the word waits for the field to empty, and the thread names the reason.

Rewind, restore, and stop with word withdrawal immediately relaunch the existing CLI between turns on the conversation without the removed turns, and text left in its input field is printed into the new field unsent. Fork and Branch birth a thread of the same CLI, which stands at once on its copy of the conversation. Fork of a thread with a running turn takes the conversation up to that turn, and the running turn stays with the source.

**Limits.** A terminal CLI does not compact and does not take images. An exact copy of the conversation exists only where the CLI itself cuts its session: Claude Code and Codex — whole and up to the turn, Grok Build — a whole fork. Everywhere else the CLI's new session gets the Tagma record: words, answers, and calls, without deliberations and full tool outputs, only the newest turns within the hook's context bound. The record names how many turns did not fit, and the thread row says the session is seeded. A plain session without hooks is not rolled back and branches only whole, where the CLI itself cuts it. TUI commands over the conversation (`/rewind`, `/fork`, `/clear`) are not seen by the journal. Unsent Gemini and OpenCode text is lost on relaunch: there is no reader for their input field. Model choice through Tagma applies at birth where its adapter declared it; OpenCode picks the model in its own TUI. Its terminal launches the bundled V2, regardless of the user's own OpenCode in PATH. Gemini's input field cannot be read, so the operator's draft does not preserve the message. A CLI does not launch in a sandbox and does not move to another worktree while its session runs.

Code: apps/tagma/server/src/external-harnesses/contract/service/table.ts#HARNESSES, apps/tagma/server/src/external-harnesses/birth/seat.ts#terminalCapabilities, apps/tagma/server/src/external-harnesses/contract/wire/hooks.ts, apps/tagma/server/src/external-harnesses/installs/mcpDeclaration.ts, apps/tagma/server/src/external-harnesses/installs/targets.ts, apps/tagma/server/src/external-harnesses/settings.ts, apps/tagma/server/src/external-harnesses/birth/installed.ts
