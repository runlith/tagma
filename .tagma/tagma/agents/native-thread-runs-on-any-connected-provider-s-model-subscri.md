---
id: 01a14b6d-b295-7f51-a786-c2330648256d
title: Native thread runs on any connected provider's model — subscription, console key, CLI login, or installed adapter
ord: 35
---
A native thread runs on any provider the machine is connected to: the operator's subscription, a console key, a vendor CLI login, or a separately installed adapter. Each thread subscribes with its own provider account.

**Which roads.** OAuth subscriptions: Anthropic, OpenAI, xAI, Muse, Kimi, Devin. Console keys: Anthropic, OpenAI, xAI, Muse, DeepSeek, StepFun, OpenCode Go, OpenAI-compatible servers (adapter setting instances). CLI login rows: Claude Code (on it the thread moves to Claude Code over ACP), Codex and Devin (their models go only in their own CLI threads). An adapter installed from npm, GitHub, or a directory (`install_adapter`) yields new rows from the next run without a restart.

**In the thread.** The picker shows models by provider with remaining quota; a thread is born on the provider's default account or a named one (`account` at birth, in model defaults, and in `set_thread_model`), without `account` keeps its own while the provider stores it; the picker's row names which account the thread is subscribed with. The agent picks a model for its child from the same rows (`read_models`).

**Limits.** A provider model whose adapter is not installed or is off — `provider-not-installed`; an unknown model or account — `unknown-model` / `unknown-account`; a saved choice yields to a fresh install's default while the adapter is missing. Login, token refresh, quotas, and the default account are run by the provider-accounts module.

Code: apps/tagma/server/src/providers, packages/adapter-anthropic/src/models/anthropic.ts#claudeCodeDescription, packages/adapter-openai/src/models/openai.ts#codexDescription, apps/tagma/server/src/threads/harness/registry.ts, apps/tagma/server/src/native-harness/contract/wire/operations/models.ts#MODEL_OPERATIONS, apps/tagma/app/src/lib/features/threads/native/ModelPanel.svelte
