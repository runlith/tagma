---
id: 01a18cbf-9775-75eb-a4a1-6542bcec10b7
title: "Features ask a model through one door by the kind of answer they need, and the chosen model's provider decides the path: request or program"
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
**Outcome.** A feature that needs a model answer outside a chat turn makes one call, naming the kind of answer it needs. The answer comes from the model the user chose, served by whatever path that model's provider declares. Translation, titles, recap, decisions and compaction summaries use this call today, and any later feature uses it and nothing else.

## What the user gets

- **One picker per kind.** Every place that chooses a model for an ask uses the composer's model picker component: favourites, providers, the reasoning strip, writing model and rung together. Those places are:
  - the translation lens chip;
  - the `translation.model`, `threads.titleModel` and `threads.decisionModel` settings;
  - the members of `agent.compactionSummarizers`.

  Each role setting holds provider, model and rung as one value under the `ask` control, which names the role's kind once; `providers` registers the write check for every key whose control or rows field names a kind. Each place filters the picker by the kind its role needs:
  - text — translation, titles, summaries;
  - decision — decisions. Decision-capable models such as OpenRouter's decision-only models are listed first, followed by models that answer objects.

  A model that cannot answer that kind is not listed. When nothing can, the picker's empty state names what to connect.
- **Every one-way user gets asks:**
  - API-key and subscription users, through `request`;
  - Claude Code users, through its print mode on the chosen model and rung (not a fixed Haiku);
  - Codex users, through the ChatGPT subscription that borrows the Codex login (`packages/adapter-openai/src/adapter.ts:15-25`, default account mode `codex`);
  - Cursor users, through its builtin runner's `--ask` program, if the Cursor SDK runs one prompt without tools. That is checked when the declaration is written, not assumed.

  A provider declaring none of these is absent from ask pickers.
- **One refusal set,** worded the same in every feature:
  - `ask-not-connected`;
  - `ask-quota`;
  - `ask-input-too-large`;
  - `ask-unreadable-answer`;
  - `ask-provider-failed` (with the provider's words);
  - `ask-unanswerable` (nothing here answers this kind);
  - `not-warm` for an ask over a thread.

  A setting write naming a model that cannot answer its role's kind refuses `setting-value`, the write door's code for a value the key does not take. The call-time refusal stays the guarantee, because a later adapter removal or disconnect is not caught by the write.

## Contract (`@runlith/tagma/adapter`)

- **Kinds a model answers** are derived, never hand-listed per feature:
  - **`request` path** (every wire provider): text; objects through native structured generation (`LLM.generateObject`, `packages/agent/src/agent/ModelRequests.ts:270-287`); decisions through the provider's decision profile when the model has the `decision` capability (OpenRouter's Decisions API stays inside its adapter), and otherwise through an object answer.
  - **`program` path:** text; objects natively when the declaration takes a schema (`claude -p --json-schema` and `codex exec --output-schema` per their documentation, unverified here), otherwise as JSON in text, validated once — an invalid answer is `ask-unreadable-answer`, with no repair step; decisions through an object answer.
  - A provider with neither path, and no wire provider borrowing its login, answers nothing.
- **Program declaration** on a harness provider:
  `asks: { program }` in `@runlith/tagma/adapter`, where `program` is a `CommandProgram` — `{ command, schemas, argv({ model, rung, system, schema? }), answer({ stdout, stderr, exit }) → text | object | refusal, usage? }`, `command` a program name and `schemas` whether `argv` takes the JSON schema — or a `RunnerProgram` — `{ runner, answer }`, a builtin runner reached through `harness-run`, whose ask flags `AskPrograms` writes beside the verb that parses them, text only. `ASK_KINDS` lives in `@runlith/llm/models/description`, which the browser loads; the derivation of a model's kinds from its route stays in `providers` (`askOffers`).
  - The input always goes on stdin and never in argv, so a translation batch or a compaction segment is never bounded by an OS argument limit.
  - `answer` maps the vendor's output, error stream and exit status to an answer or one of the refusal set. Spend is reported only when the vendor reports it; unknown spend stays unknown.
- **Borrowing.** `ModelAsks` resolves a harness provider whose account a wire provider borrows to that wire provider. This replaced the registry's `family`, whose readers were `roads.ts:146` (removed) and the session-thread context limit in `native-harness/compaction/limits.ts`, which now reads `ProviderCatalog.asks.borrower`; the field left the served wire.

## Owners

- **`ModelAsks`** — `providers` module, contract in `providers/contract/service/asks.ts`. It owns:
  - `answers(selection, kind)`;
  - `capacity(selection)`, the context and output budget that cuts excerpts and packs batches;
  - `text` and `decide` (an object answer is the decision's path inside the owner, checked against its JSON schema on both paths);
  - `choose(kind, role, asker?)`, which falls back to `defaultFor` when the role is empty;
  - the refusal set;
  - one activity per ask, naming path, model, and spend when reported.

  It runs a program through **`AskPrograms`**, a port declared in `providers` and filled by `external-harnesses`. The filler's run has these properties:
  - one child process per ask;
  - input written on stdin;
  - an empty scratch working directory, so no repository instruction file is read;
  - the environment of the selected account, or of the provider's default account when no thread is involved;
  - a deadline derived from the planned output tokens;
  - the process stopped when the ask is interrupted;
  - concurrent programs per provider bounded by a figure derived from the machine.

  `AskPrograms` is its own port rather than another member of `AccountCli`: an ask is a different subject from an account's sign-in commands. Its filler runs on the same runner as `AccountCli.run` (`external-harnesses/programs/run.ts`): a direct child of the server, not a recorded execution.
- **`defaultFor(kind, asker?)`.** One rule for every role with an empty setting, each step checking that the account is connected and that the model answers the kind:
  1. a decision role first tries a decision-capable model of a connected provider;
  2. with an asker (a thread's provider, model and account): that provider's declared light model, then the thread's own model on its lowest rung;
  3. the operator's saved default selection: its provider's light model, then that model on its lowest rung;
  4. the first connected provider in picker order whose light model answers;
  5. `ask-unanswerable`.

  The saved selection arrives through a `DefaultSelection` port declared in `providers` and filled by `native-harness`, which owns the operator preference (`native-harness/models/defaultSelection.ts`); an unreadable local store is a defect there, never a provider refusal. Connection is the cached set `ProviderAccounts.connected` keeps, which starts no CLI the operator has not selected, and the order is the catalog's picker order. An explicit role setting that cannot answer is a refusal and never switches to another model. "Lowest rung" is the ladder's declared lowest, not `reasoningOptions[0]`.
- **`ThreadAsks`** — `threads` module. `over(threadId, instruction, copy?)` answers from the thread's warm context through its transport's `aside` capability: the native capture (`ThreadAsides`) or the vendor side question (`_tagma/aside`). A copy's **basis** — run, step, reader position, model, account and expiry, as `AgentAside` holds them (`packages/agent/src/agent/AgentAside.ts:69-106`) — is what `standing` answers for a copy that still stands; `over` answers the model's words alone. `standing(copy, current)` tells a copy still standing from one whose model, rung or account moved. A copy past its cache deadline refuses `not-warm`; an ask already sent over a warm copy runs to its end, because the cache is read when the request starts. A caller whose answer describes the conversation's current state — recap — cancels its pending ask when the conversation moves and publishes only over the run it asked; a title is guarded by the title revision alone, because a newer turn or another account leaves a title of the conversation true. A thread with no aside, or a cold or unknown cache, refuses `not-warm`: `ThreadAsides` drops a copy at its cache deadline, and one with no deadline when its run ends, so a held copy is warm. The service that answered `ask_user` questions under the name `ThreadAsks` is `QuestionAnswers`.
- **Compaction summaries.** Two acts stay distinct:
  - **Folding a live vendor session.** The vendor compacts its own session, and a provider's own compaction profile stays on `ModelAccess` (`SummarizerRouter.profile`). This act is unchanged.
  - **Summarizing text through a fresh ask.** For summarizer members on the `program` path, or reached through borrowing, `CompactionAsks` (`providers/compactionAsks.ts`, built on `ModelAsks.text`) fills the core's `CompactionModels` port (`packages/agent/src/thread/compaction/CompactionModels.ts`) with what the summary strategy and `SummarizerRouter` need:
    - the run's catalog pin;
    - planned output tokens and fixed system overhead;
    - a typed overflow failure, so the strategy can step back to an earlier boundary;
    - a missing finish reason read as stop;
    - usage when reported;
    - failures classified for the chain's fall-through (`summarizerFailure.ts`).

    Wire members keep today's request.
  - Summarizer eligibility becomes `answers(model, 'text')`. A foreign compaction may then pick the thread's own provider when that provider answers text asks: the exclusion at `native-harness/compaction/spend.ts:33,44` is lifted for that case. Chat-turn callability, which keep-warm and `turnSpendability` read, stays its own predicate.
- **Features own only their question:**
  - Titles ask over the thread first, and fall back to a fresh text ask on the title model with an excerpt.
  - Recap asks over the thread only. A cold thread refuses: the operator decided on 2026-10-30 that a recap rides the hot cache alone.
  - Decisions call `decide`.
  - Translation calls `capacity`, then `text` per batch.
  - Compaction reaches `ModelAsks` through the strategy the native kernel builds (`native-harness/kernel.ts:228-231`).

## Removed

- `threads/roads.ts`, with its roles, roads and activity note.
- `providers/contract/service/decisions.ts` and `providers/decisions.ts` (`DecisionModels`). Their profile call moves to the request path (`ModelAccess.decide`), which `ModelAsks.decide` reaches for a decision-capable model.
- `HarnessLaunch.oneShot`, `Harness.oneShot`, `sessions/oneShot.ts`, and `ANTHROPIC_LIGHT_MODEL` as the program's fixed model.
- `ServedProvider.family`.
- `native-harness/models/spendability.ts#callable` as summarizer eligibility.
- The refusal codes `title-model-missing`, `recap-unavailable`, `translation-model-missing` and the decision `no-model`, together with their words in `threads/contract/wire/refusalWords.ts`, `translations/contract/wire/refusalWords.ts`, `threads/contract/wire/operations/{catalog,recap}.ts` and the app's translation `Strip.svelte`.
- The `model` and `decision-model` choice sets in `app/.../providers/choices.ts`.
- The notes describing the chain or the one-shot are corrected or retired in the same work: [[db7ababc]], [[2fa8d937]] and [[db0541d5]].

## Acceptance

1. `translations`, `threads/naming`, `threads/recap`, `threads/decisions` and `native-harness/compaction` import neither `ModelAccess`, `DecisionModels`, `HarnessAsides` nor a harness row. An enforced import rule proves it. The kernel's summary wiring is proven by test 4.
2. `translate_block` translates with a scripted wire provider, and with a test adapter whose program is a local script. With both connected, the lens picker lists both, and lists no harness that declares no path.
3. On a native thread over a scripted wire provider, with `threads.titleModel` and `threads.decisionModel` set to the test program model:
   - `generate_thread_title` answers through the program;
   - a thread decision answers through the program's object path, and an answer that does not match the schema refuses `ask-unreadable-answer`.
4. With `agent.compactionSummarizers` naming the test program model first and a scripted wire model second, `compact_thread` summarizes through the program. When the program answers a quota failure, the chain falls through to the wire member.
5. A settings write naming a model that cannot answer the role's kind refuses, both for the role settings and for `agent.compactionSummarizers`.
6. A recap over a cold thread refuses `not-warm`. An ask over a thread whose conversation moved while it was pending is not published.
7. Program conformance, through the `AskPrograms` filler:
   - an input larger than 1 MiB goes through stdin;
   - a non-zero exit becomes the refusal `answer` names;
   - an interrupted ask leaves no process;
   - with no thread, the provider's default account environment is used.
8. Claude Code's program declaration is checked against recorded `claude -p` output: argv carries `--model` and `--effort`, input comes from stdin, and text and structured answers are parsed.
9. `choose` with an empty role and only Codex connected, and the ChatGPT subscription in `codex` mode, resolves to the subscription's light model.
10. Every ask is one activity naming its path, its model, and its spend when reported.

**Remaining.** Acceptance 1 alone: rule [[93f04f23]] records the import boundary but is not enforced yet; the session building the architecture checks is enforcing it. Everything else is built (server f1fc96ce, app e0faa87f).

**Proof.** Integration tests through `translate_block`, `generate_thread_title`, the decision door, `compact_thread` and the settings write door, with a scripted wire provider and a test adapter package whose program is a local script. The program conformance suite (7), the recorded-output contract test (8), a unit test of `choose` with an empty role (9), and the import rule (1).
