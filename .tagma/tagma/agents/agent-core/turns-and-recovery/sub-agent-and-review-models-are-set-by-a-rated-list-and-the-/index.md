---
id: 01a150e5-fbff-700e-98b9-7039ac67b9de
title: Sub-agent and review models are set by a rated list and the Team menu in composer, not by prose and rules
ord: 7
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a150a6-b748-7a51-95aa-7334c9e0cb28
  - kind: relates
    to: 01a150bf-6fc7-74e5-b8df-48414dc6d09e
sources:
  - kind: dir
    ref: packages/agent/src/collaboration
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/AgentSection.svelte
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/settings.ts
---
## Why

An agent spawning a child does not know which model to take, and the operator cannot say it conveniently. Operator words today — prose in the "What each model is for" setting — reach the agent only through the deferred `read_models`, which nobody calls; the model-choice policy hardwired into the prompt is removed (`fd8ee357bf`, rule [[c9e0cb28]]). Review rests on project rules that go stale and are invisible at work time.

Needed: a short model list for sub-agents with ratings instead of prose, sensible by default for a newcomer; review policy as a setting, not rules; one compact menu in composer where the operator decides on the fly which models children run on today and who reviews, seeing account quotas.

## The sub-agent model list

**Two lists.** Available models — everything connected providers give (at the router — hundreds). The sub-agent list — short, about 10 lines; only it reaches the agent.

**A line** is a model at a concrete reasoning step (Opus high and Opus xhigh are two lines). Fields:
- `open` 1–10 — how many decisions the child makes itself: invent the design or follow the given one;
- `depth` 1–10 — fidelity and reliability on the hard: hidden causes, races, invariants, optimization;
- `taste` 1–10 — taste in code: architectural cleanliness, names, boundaries, readability;
- `ui` 1–10 — how the outcome looks to a person: interface and its words;
- `spend` 1–5 — what the model spends;
- `only` / `not` — work-type limits, from a fixed set;
- `note` — up to six English words, when the type set is not enough;
- `operatorOnly` — never auto-picked, launched only by the operator's direct word;
- `on` — whether the line stands now (the "may today" checkbox in the menu).

The scale is relative: 10 is the best available now. The user edits every field.

**By default.** The product supplies lines only for Anthropic and OpenAI with our ratings. A provider's lines show while at least one of its accounts is connected — each connected provider has its own, even when another provider supplies the same model at the same step. A supplied line stands switched off until the user picks it: agents call only explicitly chosen models. A line the user added itself is born switched on. User edits are a layer over the supplied: updating supplied values reaches unoverridden fields. The user adds other providers itself.

**Provider name.** A line group is named so the user sees what the child will go through. Where the accounts section has several sign-ins (Codex CLI or Tagma's own sign-in), the group name is the section and the way: "Codex" and "Codex Tagma". With one way — the section alone.

**Editing.** In Settings — a lines × fields matrix with "Add" from available models, "Remove", and "Reset to default". The agent edits the same list by the same settings operation at the operator's request ("add Grok, review 8, implementation 5"): it finds the model among available and writes a line.

## Picking the child's model

The included list lines, with fields, stand in the `spawn_agent` `model` parameter description — with no separate call. Above them one instruction: rate the task by `open`, `depth`, `taste`, `ui`; take the line where every rating is at least as high as needed, with the least `spend`; `only`/`not` are mandatory; `operatorOnly` only by the operator's word; a model the operator named in conversation outweighs the list. Without `model` the child inherits the parent's model. An empty list — a description with no lines.

`read_models` stops being a launch menu: it answers with the available-model catalog for editing the list. An unknown id in `spawn_agent` refuses with the catalog's nearest ids.

## Review

What review is — in the collaboration prompt, without models: an independent reading of someone else's work, findings without edits, the author confirms findings against the code and fixes, one round.

Review policy is a setting:
- **reviewer pool** — an ordered list of lines from the sub-agent list with `on`; order is priority; a line whose account is exhausted is skipped;
- **count** — 0 (no review), 1, or "up to N"; N is a ceiling, the agent itself decides how many are needed;
- **split** — `Same`: one brief to all, in isolation; `Lenses`: the first reads everything, the rest one lens each;
- **lenses** — correctness, architecture, performance, tests, security, UX.

An empty pool or a 0 count — no review launches. Project rules [[e1162847]] and [[39721601]] are replaced by this setting and removed.

## The Team menu in composer

The `Team` button does not change: the `Team`/`Solo` icon and word; a dot only while the thread holds its own setting. The menu (≈264 px, the app's tokens and font, the interface in English):
- home page: `Solo` | `Team` tabs across the whole menu width, no caption (the same words as on the button; in Solo the rest of the menu hides), `Depth`, `Agents run on ›` (included-model names or "N models"), `Reviewed by ›` (reviewer names or "Nobody"), an `Only this thread` switch with a scope caption; items are named by who works, so they are not confused with the thread's own model;
- `Agents run on ›` — "Models sub-agents may use": lines grouped by provider, at the group header a whole-provider switch and the used quota; at a line the `on` checkbox; `Edit list…` leads to Settings;
- `Reviewed by ›` — "Who reviews their work": count, pool with checkboxes, `Same`/`Lenses`, lens chips.

`Agents run on` and `Reviewed by` are independent: a line switched off in the first stays in the reviewer pool ("Opus does not implement today, but reviews").

Each model line carries a quota indicator from the status line (`Gauge.svelte`): the provider icon and next to it a ridge of five tiles of 20% of the account quota used, `--severity-gap` from 80%, the percent on the right. Mockup: http://localhost:5634/a/c3b9d910efd2

## Scope and delivery

A menu edit applies at once and only to this thread and its sub-agents: the thread receives its own copy, taken from the project's current setting. No scope choice in the menu. While the thread copy differs from the project, at the menu bottom (on any of its pages) a line "This thread differs from the project." with `Reset` actions — drop the copy and follow the project again, including what was made in it meanwhile — and `Use for all threads` — write the thread set into the project setting with one act; after it a toast "Every thread of the project now uses this." with `Undo`, returning the project's earlier setting. On the `Team` button a dot while the thread differs from the project. A thread with no own copy follows the project, and a project change reaches it on the next step. The machine level — in Settings on the same form; the project inherits it until it sets its own. The existing settings layers (machine → project → thread), as with `agent.delegation`.

The change reaches working threads on the next step with one line assembled from the setting, by the same mechanism as the delegation notification (`delegationRule`). The thread's `spawn_agent` description takes the current list on every step.

## What is removed

- the `agent.modelGuidance` ("What each model is for") setting and its form;
- `read_models` as a model-choice menu;
- rules [[e1162847]], [[39721601]] — once the review setting replaces them.

## Decided, and why

- **The agent picks by the list in the description, not the server by axes**: at ~10 lines that is cheaper and more transparent; the description length is set by the operator, not by the subscription count.
- **Ratings of task properties, not of occupation types**: "implementation" is both simple and hard; open, depth, and taste decide between models.
- **`taste` and `ui` apart**: the link between code quality and visual taste is unproven.
- **Reviewer — the operator's pool, not derived from axes**: who reviews depends on quotas and the user's habits.
- **Price in quota is deferred**: idea [[4dc6d09e]].

## Readiness criteria

- The thread's `spawn_agent` description holds the included list lines with fields and the instruction; with no connected provider — without its lines.
- A newcomer with an Anthropic account sees the supplied Anthropic lines switched off in the menu; the `spawn_agent` description omits them until picked.
- Groups of two sign-in ways of one section are distinguishable by name in the Team menu, in the reviewer pool, and in Settings.
- A Team-menu edit at the project level reaches the project's working thread on the next step; `Only this thread` — only that thread and its team.
- An empty pool or 0 — the delivered line says "Review: none", no reviewer launches.
- The `agent.modelGuidance` setting and its form are gone; `read_models` answers with the catalog.
- Typecheck and the affected packages' tests pass; minimal contract tests: description assembly from the list, layer merging, change delivery.

The operator's check — the menu and Settings appearance — is not a task-completion condition.
