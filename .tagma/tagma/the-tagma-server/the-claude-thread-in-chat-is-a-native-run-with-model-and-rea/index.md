---
id: 01a14fe9-0964-7561-900a-61f7987b9fc1
title: The Claude thread in chat is a native run with model and reasoning through any door; “Claude Code” (`harness:claude-code`) is born in the terminal, switching between them is one button
ord: 133
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a11c9a-6edb-7ed8-b517-60ac9116e494
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928e44dc7c58
  - kind: relates
    to: 01a14faf-bb73-7377-8fb4-1f38c016c087
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/birth/transport.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/sessions/switch.ts
  - kind: file
    ref: apps/tagma/server/src/threads/voice/rowDetail.ts
---
## Why

Tagma has two different kinds of thread:

- **Native thread** — the Tagma agent: our chat, our loop, prompt, tools, law and feed. The transport to the model — keyed API, subscription via its own entry, Claude via the Claude Agent SDK (ACP) — is an implementation detail. The user never sees it: model, reasoning, list row, chat, menu and acts are the same ([[e5eed6b8]], [[af264e00]]).
- **Vendor CLI agent** — someone else's agent with its own interface: a terminal TUI (Claude Code, Codex, Grok Build, Cursor, Gemini CLI) or a chat with the vendor's agent over ACP (Devin).

The code (at `7a5bdea1a1`) treats Claude on ACP not as a native-run transport but as a `claude` harness mode — the same name as terminal Claude Code. So three doors lead into the native Claude run, and only one is right:

1. **The `claude-code` provider model** — operator birth, spawn and fork with a model, `set_thread_model`. The thread seats via `HarnessRegistry.seating` and gets model and reasoning like a native one. The right door.
2. **The `threads.harnessTransport.claude = acp` setting.** The “Claude Code” menu row and `spawn_agent` with `harness:claude` birth an ACP thread bypassing native birth: with no model or reasoning. That is how [[01a14fdd-3342-7c82-b8d8-911e49f5396c|Runlith command rule limits]] was born: a `claude-code/—` row, reasoning unread.
3. **The switch button (`set_thread_transport`)** from terminal Claude Code into chat. Switching is needed and stays, but today the thread seats on ACP with whatever choice the CLI had — often empty — and then also with no model or reasoning.

Because of door 2 and the empty choice on door 3, the list row carries `harness` with `transport: acp` for such a thread, and the app distinguishes the transport: the `hosted` branch in `ModelPlate`, `hostsAgent` in `external/roads.ts`, the “Tagma agent” / “Open in Claude Code” chip words, the `acp.hosts` check in `ConnectCard`. This contradicts the model where a native run's transport is invisible. Commit `7a5bdea1a1` substitutes the vendor-reported model into the row — hiding the symptom — and is removed by this work.

## What the operator gets

- **New agent** with a Claude model — a native thread: model and reasoning from the default ([[57524b3d]]) or chosen, row and chat like any native one.
- **Claude Code** in the menu and `harness:claude-code` in `spawn_agent` — always the real Claude Code in the terminal, whatever the settings.
- The Claude thread switches with one button between chat (native ACP run) and the Claude Code TUI in the terminal and back, keeping the same vendor session, as now. In chat it is always on a model and reasoning: when switching from the terminal — the ones the CLI reported or it was born with, otherwise the model default, as at native birth.
- Devin is unchanged.

## Decision

### 1. The harness name is `claude-code`

Harnesses are named for the product they start: `codex`, `grok`, `devin`, `cursor`, `gemini`. Claude Code becomes `claude-code` (type `harness:claude-code`, `HARNESS_LABELS['claude-code'] = 'Claude Code'`); the binary stays `claude`. The `claude-code` provider id (Claude models via the Claude Agent SDK, “Claude” in the interface) is a different namespace, and the match is honest: that provider is Claude Code running as an SDK.

### 2. The Claude ACP profile belongs only to the native road

A new thread on the Claude Code adapter's ACP profile (`hosts: 'tagma'`) is born only by model choice, via `HarnessRegistry.seating`. Birth by `harness:<name>` type never takes it:

- `threads.harnessTransport` loses the `claude` key; the setting description says it picks the CLI road whose ACP drives the vendor's own agent.
- `birthTransport` yields `acp` only for a profile with a vendor agent; for a profile hosting the Tagma agent, type birth is always the terminal. This is a profile property (`hosts`), not a vendor name ([[6f758080]]).
- `set_thread_transport` switches the Claude thread between terminal and ACP both ways, as now. Switching to ACP writes the full choice into the kernel row: the model and rung the CLI reported in attendance (the operator may have changed them in the TUI), otherwise the ones the thread was born with, and whatever is missing — the model default, as at native birth. After switching, a native ACP run's row is indistinguishable from a model-born one.

### 3. The native run's row does not give away the transport

The wired list row (`ThreadListRow`) and the thread snapshot:

- `harness` (`HarnessRowDetail`) exists only on a vendor-agent thread (`binding.agent === null`). A native ACP run has none — like a native API one.
- Capabilities (`TransportCapabilities`) sit in every thread's row, not inside `harness`. The app decides controls from them (compaction, resume, screen, model switch), as [[0f8d8726]] requires.
- The `agentId` and “born as” of a native ACP run is the Tagma agent (`binding.agent`), not a harness.

The app removes everything that distinguished the native run's transport in the row and model picker: `hosted` and the `7a5bdea1a1` substitution in `ModelPlate`, the `acp.hosts` check in `ConnectCard`. The TUI switch button stays: the server serves its availability in the native run's row whenever it has a terminal road (a switch field next to capabilities), and the app paints the button from it, not from the ACP profile. The server serves the provider list the Tagma agent runs on (needed by the entry card) from the same owner, `HarnessRegistry.seating`; the app never reads the ACP profile.

### 4. The “+” menu

Unchanged, except the Claude Code row: it always shows the terminal mark on the right.

### 5. Stored data — one migration

Steps in the owners' folders ([[acb620dd]], [[a4d62ee7]]):

- The harness name `claude` → `claude-code` everywhere it is stored: session rows, the type and `agentId` of `harness:claude` threads, the `{adapter, profile}` binding profile, the `threads.harnessProfile` and `threads.harnessTransport` setting members, thread rollout copies — as a journal-shape step.
- The `claude` key leaves the stored `threads.harnessTransport` layers.
- Native `claude-code` threads with an empty model (born through doors 2 and 3) get the provider's default model and the rung native birth would have given. Post-migration invariant: every thread on a model provider has a model in its choice.

On-disk agent definitions naming `harness:claude` are user files; the executor checks whether any exist in code and in the distribution, and renames the distributed ones.

### 6. Test rigs

Rigs that birthed Claude on ACP via the setting (`protocolClaudeRig`, `protocolWorld`, `parityWorld`, `protocolRuns`) birth a native run on the `claude-code` model: operator birth with a model or `spawn_agent` with a model. Terminal rigs take `harness:claude-code`.

### Graph

- Feature [[44dc7c58]] (“Claude Code and Devin run over ACP; the thread switches…”) is rewritten for the new name and the full model choice on switch. [[b50ae262]] and [[4519ff2b]] are fixed for the new name and doors. Note [[076a4c60]] — by the same change.

## Performer proof

- Through public operations: `harness:claude-code` is born in the terminal with stored `{claude: 'acp'}` before migration; `set_thread_transport` of a terminal Claude Code with no chosen model to ACP yields a row with model and rung and no `harness`, and back — the terminal again; birth on the `claude-code` model with no named model yields a row with model and reasoning and no `harness`.
- Migration test: a database with a `claude` session, a `harness:claude` thread, an `acp/claude/tagma` binding with an empty model and a `threads.harnessTransport = {claude: 'acp', devin: 'acp'}` layer holds `claude-code`, model and rung, `{devin: 'acp'}` after the step.
- Affected protocol and parity system tests pass on the new rigs; typecheck and unit tests of affected owners.
- `rg` over `apps/tagma/app/src` finds no `hosts === 'tagma'`, `hostsAgent`, `'harness:claude'`.

## Operator checks

Not a task-closing condition: the menu — “Claude Code” opens the TUI, “New agent” on Claude opens chat with model and reasoning; such a thread's row is indistinguishable from a native one; old threads show a model after migration.
