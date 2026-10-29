---
id: 01a14b6d-b1fb-7c86-915f-29f4edfc1581
title: Operator moves a thread to another model, rung, switches, or account — mid-turn and between the native agent and Claude Code
ord: 11
---
The operator moves a conversation to another model, reasoning rung, model switches, or account without losing history and feed — even mid-turn and even between the native agent and Claude Code.

**How.** The model picker in the composer (`/model`, `/reasoning`, clicking the model chip): models by provider with remaining quota in the header and context size, a road mark on models served by another harness (Claude Code), favorite stars and their order, the model switches toggles and lists, the account row the thread is subscribed with (the account itself changes in the status bar). The `set_thread_model` operation (operator); from the terminal `tagma threads set <id> --provider --model [--reasoning]`.

**Behaviour.** Inside the native road the row changes at once, and the running run finishes on its own model. A model served by another harness moves the thread onto it (`claude-code` provider models — onto Claude Code over ACP), a native model returns it back; the thread keeps the journal and feed. A running turn is carried over: the call waits for the current step's end, moves the thread, and continues the turn there; if the step does not end within three minutes — `thread-running`, the turn goes on untouched; a failed switch returns the stopped turn as a continuation on the old model. Without `account` the thread keeps its own while the provider holds it.

**Limits and refusals.** A terminal CLI thread is `model-pinned`: the model is set at birth. A CLI agent of its own type stays on its provider's row (`model-provider`). A provider model whose login is a CLI, but no harness hosts a Tagma agent on it (Codex, Devin) — `model-unavailable`. Also `provider-not-installed`, `unknown-model`, `unknown-account`, `model-switch-unsupported`, a thread on a host — `harness-host`, a process that has not ended yet — `session-uncertain`.

**Links.** The default model and favorites; the agent changes the child's model; the ACP transport.

Code: apps/tagma/server/src/native-harness/contract/wire/operations/models.ts#MODEL_OPERATIONS, apps/tagma/server/src/threads/harness/moves.ts, packages/agent/src/collaboration/modelCarry.ts, apps/tagma/server/src/threads/harness/registry.ts, apps/tagma/app/src/lib/features/threads/native/ModelPanel.svelte, apps/tagma/app/src/lib/features/threads/native/commands/model.commands.ts, apps/tagma/server/src/threads/cli/threadVerbs.ts
