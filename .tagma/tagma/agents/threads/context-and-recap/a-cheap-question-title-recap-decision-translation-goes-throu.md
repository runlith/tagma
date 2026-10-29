---
id: 01a11127-7009-727d-9639-b5f1db7ababc
title: "A cheap question — title, recap, decision, translation — goes through one chain: a named or the role's configured model, the decision model, the provider's light model, a one-shot CLI, the thread's model on the bottom rung"
ord: 1
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a110fc-ee3e-7fd1-8fcc-accd4dc050c7
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/naming/excerpt.ts
  - kind: file
    ref: apps/tagma/server/src/threads/roads.ts
---
A title with no warm copy, a manual journal recap, and a thread decision ([[8105540f]]) ask a cheap model, and one chain picks it — `threads/roads.ts`. The role is the selection parameter: it names its model setting and rung and says whether the asker answers by schema. Recap goes as the role with title settings (`threads.titleModel`), a decision with its own (`threads.decisionModel`, `threads.decisionReasoning`). The order holds price and what the thread really has; the answer goes the first road that can answer. The selection leaves `model-chosen` in its attempt's activity: the travelled road and the rejected ones with reasons belong to that attempt, read from the record rather than reconstructed from current settings.

- **The role's configured model** — always it; an unresolvable one yields `invalid-selection`, not the next road: the operator picked a model, and silently answering with another would deceive him.
- **Decision model** (`decision-capable`) — only for a schema role: the catalog's first model with the `decision` capability whose provider has an account. It answers faster, cheaper and with a probability; `ThreadDecisions` asks it with the provider's native call (`DecisionModels`), not a text adapter. Such models are brought by the provider catalog read with its key, so with no key the road is rejected `not-declared`.
- **Provider light model** (the description's `lightTextModel`), only when the provider has an account: otherwise the request would go to a refusal. For an external thread the provider is the `family` of its CLI provider's description: a CLI provider never calls the API. Haiku is at `anthropic` by key and at the CLI itself.
- **One-shot CLI call** — a harness adapter capability (`launch.oneShot`), the vendor core does not know it. It answers text with no schema, so a schema role skips that road with reason `no-schema`. A probe on Claude Code 2.1.291 showed: `claude -p --no-session-persistence` with no tools, settings or MCP leaves no session file and no `ai-title` of its own; its spend exists only when the CLI reported it.
- **The thread's model on the bottom rung** — only for a native thread: an external one has no model of its own in Tagma.
- **Nothing fit** — the `none` road; what it means is the role's call: "Generate title" refuses `title-model-missing`, manual recap — `recap-unavailable`, a decision — `no-model`.

The chain asks for an asker — the provider, model, account and harness a thread runs on — not a thread, so a caller with no thread passes none: a block translation ([[1d5f53a4]]) does. With no asker the provider light model is that of the first connected provider declaring one in the catalog's provider order, and the CLI and thread-model roads are rejected `no-thread`. A caller may name a model for one ask; it comes before the role's setting as the `named` road and, unresolvable, yields `invalid-selection` the same way.

The role's rung from settings applies to the chain-picked model only when it offers one; otherwise the road's rung stays. The excerpt under the picked model's window for title and recap is cut by `naming/excerpt.ts`; a decision does not cut the input but refuses `input-too-large`.
