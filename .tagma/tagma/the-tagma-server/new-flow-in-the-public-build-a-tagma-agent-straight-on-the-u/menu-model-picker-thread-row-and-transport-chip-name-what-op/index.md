---
id: 01a14faf-e87e-7b93-9852-5c59ed037ca0
title: "\"+\" menu, model picker, thread row and transport chip name what opens: a Tagma agent or a CLI in a terminal"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928db50ae262
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928e44dc7c58
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/ColumnHead.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/external/transport.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/launch.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/HarnessMark.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/ModelPlate.svelte
  - kind: file
    ref: packages/adapter-anthropic/src/adapter.ts
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/settings.ts
    symbol: harnessTransport
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/harness/names.ts
    symbol: HARNESS_LABELS
---
## Agent-column "+" menu

`threads/ColumnHead.svelte`, `threads/launch.ts`.

- **New agent** — first row: the Tagma mark; second row — the model and default source ("Claude Opus 5.5 · Claude plan"), with no sign-in — "No model connected". Click opens a draft, as `startDraft()` does now.
- **Terminal** — a section replacing "Harness in terminal". Rows are CLIs on the machine. Each has the CLI mark on the left and the mark of what opens on the right: a terminal, or chat for a vendor whose `threads.harnessTransport` is `acp` (Devin). Click always births `harness:<cli>`; the `serves` branch (a draft with the `claude-code` model) leaves the menu.
- Version and binary path go in the row hint. The row itself carries only what needs action: for an unfound CLI — "Install" if the adapter declared an install command (the same terminal as in the sign-in card), else "Not installed"; "Check again" stays. No colored dots.
- **New folder** — at the bottom past a divider: a folder is not a thread.

## Names and marks

- The `claude-code` provider: name "Claude", mark — the Claude spark (`icon` of the Anthropic adapter). The Claude Code pixel mark (`claudeCodeIcon`) becomes the Claude Code CLI's mark and stands only on the terminal thread and the menu row.
- The `openai-oauth` provider: "ChatGPT" instead of "OpenAI OAuth".
- The CLI mark is declared by the harness adapter (`HarnessAdapter`) for Claude Code, Codex, Grok Build, Devin, Cursor and Gemini CLI. `HarnessMark` reads it from there, and the app's `OWN` map (`cursor.svg`, `gemini.svg`) moves into the adapter declarations.
- `HARNESS_LABELS.gemini` is "Gemini CLI": that is the product's name.

## Model picker

`threads/native/ModelPanel.svelte`, `providers/served.ts` (`billedLabel`).

- Group heading — the provider name and the payment source derived from `auth`: subscription (`oauth`, `cli`) — "plan", key — "API key". That gives "Claude · plan", "ChatGPT · plan", "Anthropic · API key". The "ACP" and "over ACP" labels go: the user picks who pays, not the protocol. Quotas stay in the heading.
- Groups stand in the product's common order: the Claude and ChatGPT subscriptions first.

## Thread row in the list

`threads/native/ModelPlate.svelte`, `HarnessMark.svelte`.

- One text for all threads — model and effort, as `harnessWords` gives now. The CLI name goes in the hint and where the model is unknown (the CLI started on its own default and does not report a model).
- Terminal thread: CLI mark on the left, terminal mark after the model.
- A Tagma agent on ACP renders as native: provider mark (Claude spark), model, effort.

## Transport chip on the thread

`threads/external/transport.ts`, `TransportChip.svelte`.

- Claude: "Claude Code" (terminal) ⇄ "Tagma agent" (ACP); the action names where it moves: "Continue as Tagma agent" or "Open in Claude Code".
- Devin: "Terminal" ⇄ "Chat".
- No "ACP" in the interface. Transport relaxations (`proofWords`) show as now.

## `harness:claude`

- The `claude` key in `threads.harnessTransport` stays, defaulting to `terminal`: protocol stands (`protocolClaudeRig`, `protocolWorld`, `parityWorld`) birth Claude on ACP through `harness:claude`. The menu shows on the right the road the setting gives.
- A Tagma agent on Claude is born from the menu through "New agent" with the `claude-code` model.
- The terminal-CLI and Claude-and-Devin-on-ACP features are amended in the same work.

## Implementer proof

- Typecheck and the affected owners' tests.
- Inspection on one's own `tagma:try`: menu, model picker, list rows, transport chip — with screenshots in the report. No tests on copy or layout.
