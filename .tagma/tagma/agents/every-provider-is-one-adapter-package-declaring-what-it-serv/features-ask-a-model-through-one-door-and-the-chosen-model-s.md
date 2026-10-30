---
id: 01a18cbf-9775-75eb-a4a1-6542bcec10b7
title: "Features ask a model through one door, and the chosen model's provider decides the path: request, program or session"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a11127-7009-727d-9639-b5f1db7ababc
  - kind: relates
    to: 01a188b6-199d-7ef5-9da5-32671d5f53a4
---
**Outcome.** A feature that needs a model answer outside a chat turn makes one call. The answer comes from the model the user chose, served by whatever path that model's provider declares. Translation, titles, recap, decisions and compaction summaries use it today. A later feature uses it and nothing else.

## What the user gets

- **One picker.** Every place that chooses a model for an ask is the composer's model picker, the same component with favourites, providers and the reasoning strip, filtered to providers that answer asks:
  - the translation lens chip;
  - the `translation.model`, `threads.titleModel` and `threads.decisionModel` settings;
  - the members of `agent.compactionSummarizers`.

  A provider whose package declares no ask path is not in that picker. When nothing can answer, the picker's empty state names what to connect.
- **Claude Code users translate.** On a machine with only Claude Code, translation, titles and decisions work. The provider's program path answers them on the model the user picked, not a fixed Haiku. The same holds for any CLI whose package declares a program path.
- **One refusal set.** An ask that cannot run says why once, in the same words in every feature:
  - the provider is not connected;
  - its quota is spent;
  - the input is larger than the model takes;
  - the answer could not be read;
  - the provider's own failure.

  A role setting can no longer name a model nothing can call: the write refuses it.
- **Defaults without a chain.** With a role setting empty, the model is chosen like this:
  - the asking thread's provider's declared light model, when that provider answers asks;
  - otherwise the light model, or the lowest rung of the default model, of the project's default selection;
  - otherwise the refusal "no model here answers outside a chat".

  The rule is the same for every role.

## Contract (`@runlith/tagma/adapter`)

A provider declares its ask path in its offer:

- **Wire providers** answer asks through the generic request path. They declare nothing.
- **A harness provider** may declare `asks: { path: 'program', argv(selection, instructions, input), answer(stdout) }`. Its program runs once, with no session, tools, settings or MCP. This is Claude Code's `-p` declaration today, generalised to the chosen model and rung.
- **A harness provider** may declare `asks: { path: 'session' }`. Its ACP agent opens a fresh session with no MCP servers and answers one prompt. The package declares this only where its agent runs no built-in tools in such a session. Whether each vendor's ACP agent qualifies is checked when its package is written, not assumed.
- A provider with neither does not answer asks. The served catalog carries `asks: true | false` per provider, computed from the declaration. That flag is the one predicate every picker, setting write and chain reads.
- A provider with a structured-answer endpoint answers decision-shaped asks through its own profile. OpenRouter's Decisions API stays here, inside its adapter. The feature never names it.

## Owners

- **`ModelAsks`** — `providers` module; contract in `providers/contract/service/asks.ts`. It owns:
  - `capacity(selection)`: the context and output budget used to cut excerpts and pack translation batches;
  - `text(selection, ask)` and `object(selection, ask, schema)`;
  - `decide(selection, request)`;
  - `defaultFor(context)`;
  - the refusal set;
  - activity accounting of each ask: model, path and spend.

  How it serves each path:
  - **request path**: through today's requester with the ask's cache policy (`cache: 'none'` unless the profile says otherwise);
  - **program path**: through `AskPrograms`, a port declared in `providers` and filled by `external-harnesses` with one generic runner — spawn under `purpose: 'internal'`, the account's environment, the package's argv and parser — as `AccountCli` is filled today;
  - **session path**: through `AskSessions`, a port filled by the ACP driver.

  For a path with no structured output, `object` and `decide` are served once, here, by asking for JSON that matches the schema, validating it, and repairing it once (`@runlith/llm/textDecision` today).
- **`ThreadAsks`** — `threads` module. `over(threadId, ask)` answers from the thread's warm context through its transport's `aside` capability: the native capture (`ThreadAsides`), or the vendor side question (`_tagma/aside`). A thread whose transport has no aside, or whose cache is cold or unknown, refuses `not-warm`. The feature then decides whether a fresh ask suits it.
- **Features own only their question.**
  - Titles ask `over` first and fall back to a fresh ask on the title model with an excerpt.
  - Recap asks `over` only. A cold thread refuses, by the operator's decision that a recap rides the hot cache alone. The standing rule allowing a manual cold recap with a notice is corrected with that decision.
  - Decisions call `decide`.
  - Translation calls `capacity` and `text` per batch.
  - Compaction summaries reach `ModelAsks.text` through the summary strategy the native kernel builds (`native-harness/kernel.ts:228-231`). A summarizer member is any provider that answers asks, so a Claude Code model can summarize a foreign compaction.

## Removed

- `threads/roads.ts`: `RoadRole`, `Road`, the six roads and their activity note.
- `providers/contract/service/decisions.ts` (`DecisionModels`).
- `HarnessLaunch.oneShot` and `sessions/oneShot.ts`, replaced by the program path's generic runner.
- `native-harness/models/spendability.ts#callable`, replaced by the `asks` flag.
- The per-feature refusal codes `title-model-missing`, `recap-unavailable`, `translation-model-missing` and the decision `no-model`, replaced by the ask refusal set.
- The `model` and `decision-model` choice sets of `app/.../providers/choices.ts`, replaced by the picker.
- The model notes and explanations describing the chain are corrected or retired in the same work.

## Acceptance

1. No file in `translations`, `threads/naming`, `threads/recap`, `threads/decisions` or `native-harness/compaction` imports `ModelAccess`, `DecisionModels`, `HarnessAsides` or a harness row. An enforced import rule on those directories proves it.
2. `translate_block` translates with a scripted wire provider and with a test adapter's program provider. The lens picker for that machine lists both, and nothing else.
3. With only the test program provider connected and every role setting empty, `generate_thread_title` and a thread decision answer through the program path.
4. A settings write naming a provider without an ask path refuses. The same name in `agent.compactionSummarizers` refuses.
5. A recap over a thread whose cache is cold refuses `not-warm`. An automatic recap is written only over a warm thread.
6. Every ask is one activity naming its path, model and spend.

**Proof.** Integration tests through `translate_block`, `generate_thread_title`, the decision door and the settings write door, with a scripted wire provider and a test adapter package whose program is a script printing a fixed answer. Plus the enforced import rule of acceptance 1.
