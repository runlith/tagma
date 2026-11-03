---
id: 01a14bae-6720-7d62-897a-9280825673b8
title: Operator moves a thread to another model, rung, switches, or account — mid-turn and between the native and hosted agent
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: supersedes
    to: 01a14b6d-b1fb-7c86-915f-29f4edfc1581
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/providers/models/CatalogList.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/commands/model.commands.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/ModelPanel.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/PickerHeading.svelte
  - kind: file
    ref: apps/tagma/server/src/threads/cli/threadVerbs.ts
  - kind: file
    ref: apps/tagma/server/src/threads/harness/moves.ts
  - kind: file
    ref: apps/tagma/server/src/threads/harness/registry.ts
  - kind: file
    ref: packages/agent/src/collaboration/modelCarry.ts
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/contract/wire/operations/models.ts
    symbol: MODEL_OPERATIONS
---
**Value.** The operator changes the model mid-conversation — cheaper, stronger, at another provider — without losing history, even mid-turn and even between the native agent and Claude Code.

**How.** The model picker in the composer (`/model`, `/reasoning`), the `set_thread_model` operation, `tagma threads set`.

**Picker.** On the left a rail: the favorite star and one tab per provider-accounts section (Claude holds a login through Claude Code and a Tagma login), under the sign — the quota ridge, a gold tile in the corner — the thread model's tab. Search runs over all tabs. Inside a tab models stand under their provider's header: the account quota and the account itself on the right, followed by a dim word: "Follows default" when the thread signs with the provider's default account, "Pinned" when it holds an explicit one (the open list's "Follow the default" returns it); on the thread's provider the account choice is written into the thread at once, on another — remembered and saved together with the model in one write. In the row under the cursor — reasoning as a button strip with the rung word (pressing picks the model with that rung, ←→ move it) and model modes as icons (⚡ Fast); on the current model off-cursor — its rung's word. No footer: the model context is in its name's hint. The same list serves the model default in settings and the compaction model choice.

**Behaviour.** Rung, switches, and account change with the model. A running turn is carried over: the switch waits for the current step's end and continues the turn on the new model; if the switch stops waiting before the step ends, the turn is left untouched, and a failed switch continues it on the old one. A model served by the Claude Code or Cursor hosted runner moves the thread onto it; a native one returns it. Journal and feed survive, and the new session gets their history with images. A model and parameter change inside Cursor applies from the next turn with no new process.

**Limits.** A terminal CLI thread gets its model at birth; a CLI agent stays on its provider, moving to another account only by restarting its own CLI ("Continue on <selected>"). Codex and Devin login models go only in their own CLI's threads. A sandbox thread does not move to another harness.
