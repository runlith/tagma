---
id: 01a14bae-6720-7d62-897a-928e44dc7c58
title: Hosted profile runs the Tagma chat; declared transports and the shared vendor session determine switching to the terminal
ord: 6
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9280825673b8
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928f4a7de7db
  - kind: supersedes
    to: 01a14b6d-b251-7de8-8df7-718937136e0e
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/AgentTypes.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/external/transport.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/external/TransportChoice.svelte
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/birth/transport.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/cli/harnessRun.ts
  - kind: file
    ref: apps/tagma/server/src/threads/harness/registry.ts
  - kind: file
    ref: packages/adapter-cursor/src/harness/acp.ts
  - kind: file
    ref: packages/adapter-devin/src/harness/acp.ts
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/birth/seat.ts
    symbol: acpCapabilities
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/contract/service/table.ts
    symbol: transportOf
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/contract/wire/operations.ts
    symbol: HARNESS_OPERATIONS
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/settings.ts
    symbol: harnessTransport
  - kind: symbol
    ref: packages/adapter-anthropic/src/harness/acp.ts
    symbol: claudeAcp
  - kind: symbol
    ref: packages/adapter-opencode/src/harness/acp.ts
    symbol: opencodeAcp
---
**Value.** A hosted run looks and is managed like a regular Tagma agent, while the vendor runs its model and tool loop. Claude Code, Cursor, and OpenCode get Tagma's prompt and tools with law on every call; Devin runs its own agent.

**How.** Picking a hosted-provider model births a Tagma chat. Explicit `harness:claude-code`, `harness:cursor`, and `harness:opencode` open terminal CLIs; only terminal surfaces stand in "CLI agents". Claude, Cursor, and OpenCode models are picked in the regular picker, regardless of a separate terminal CLI. The `threads.harnessTransport` setting picks the transport of new runs that do not host Tagma. The adapter itself declares a transport's availability: no terminal launch means no terminal surface, and an unavailable requested transport answers with a typed refusal instead of a substitution.

**Behaviour.** `set_thread_transport` switches transports between turns where the vendor shares the session: the terminal rises at once at the CLI prompt, ACP with the next turn. A run with a terminal profile is not moved to chat. The browser gets the CLI view and the available transports from the server answer without loading runtime adapters. A terminal run's model shows with the provider recorded in the run's core.

**Limits.** Hosted and terminal sessions of Cursor and OpenCode share no history, so switching between them refuses. OpenCode runs the official V2 CLI from the install with the profile login on the Providers screen. Claude Code and Devin need CLI login; Cursor needs a key on the Providers screen. A live Cursor turn without a key is untested.
