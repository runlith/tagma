---
id: 01a18cbf-8498-75d8-913f-c74f6f376186
title: Every provider is one adapter package declaring what it serves, and every feature asks through one door without knowing which provider answers
ord: 102
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0fd8b-beed-7934-884b-a443f92da92b
  - kind: relates
    to: 01a0fd8b-bf09-7bd4-86c2-a17f287a4906
  - kind: relates
    to: 01a18cab-8c51-72ae-a0eb-1a8d08285d75
---
**Outcome.** A provider is one adapter package. It declares what it serves: chats, asks, titles, compaction. A feature asks for a model answer through one door and never learns which provider, transport or program answers. A user with only an API key, only a subscription, only an SDK, only an ACP agent or only a terminal CLI gets every feature that this one way in can serve. What it cannot serve is never offered, and is said once where it would be offered. Adding, removing or switching a provider — a new CLI the user brings, a provider dropped from the public build for its terms — is a package added or removed. It is never a release of the server's core.

**Why.** A reading of the whole agent stack on 2026-10-30 found one ask served ten ways:

- **Two owners of "callable".** The catalog lists every provider, wire and harness alike (`providers/registry.ts:131`). `ModelAccess.request` reaches wire providers only (`providers/access.ts:22-39`).
  - So the pickers of `translation.model`, `threads.titleModel` and `threads.decisionModel` (`app/.../providers/choices.ts:14-26`) offer rows that every call then refuses. The summarizer chain does the same: `callable()` tests only `auth !== 'cli'` (`native-harness/models/spendability.ts:10-12`), so Cursor passes.
  - This is the `claude-code:claude-haiku-5-5` translation failure.
- **Side calls know vendors.**
  - Titles, recaps, decisions and translations pick their model through a six-road chain (`threads/roads.ts`). Its roads are vendor features: a light model only on wire providers, a one-shot program only for Claude Code (`HarnessLaunch.oneShot`, `vendors/claude-code/row.ts:56-85`, fixed to Haiku 4.5), a side question only on a Claude ACP session.
  - Decisions branch on OpenRouter's Decisions API (`threads/decisions.ts:116-118`).
  - Each feature has its own refusal: `title-model-missing`, `recap-unavailable`, `no-model`, `translation-model-missing`.
  - So a user with only Codex, Grok, Gemini, Cursor, OpenCode or Devin gets no title of Tagma's, no recap and no decisions.
- **CLI vendors are a closed list in the server.** Wire providers are packages, including machine-installed ones: Muse OAuth is `@runlith/adapter-muse-oauth`, installed by `install_adapter`. A CLI is spread over the server:
  - `HARNESS_NAMES` (`threads/contract/wire/harness/names.ts:4`);
  - the `ADAPTERS` table (`external-harnesses/contract/service/table.ts:26`);
  - vendor rows under `external-harnesses/vendors/*`;
  - hand-written setting key lists that disagree (`external-harnesses/settings.ts:23-29, 48-55`);
  - the runner switch (`external-harnesses/cli/harnessRun.ts:16`) and `HOOK_FORMATS`.
- **Declarations that do not hold.**
  - Cursor and OpenCode declare `proves.fork` and `proves.rewind`, which their runners never implement.
  - The ACP transport declares `compaction: 'session'`, while those two are `foreign`.
  - A native row says `web: 'none'` while using vendor web.
  - Births accept a CLI that is not installed (`external-harnesses/serving.ts:17-18`).
  - A CLI's own title call is paid and then discarded when `threads.autoTitle` is off (`protocol/launcher.ts:176-178` against `external-harnesses/assembly.ts:197-199`).

## Words

- **Thread** — the chat where a person and an agent work. Only that. Keep-warm and compaction are runs inside a thread. An ask is not a thread.
- **Provider** — a way in to models, declared by an adapter package: identity, accounts, catalog, and its **offer**.
- **Offer** — what the provider serves and how:
  - **chat**: the transports its threads run on (`native`, `acp`, `terminal`);
  - **asks**: the path that answers one question outside a chat turn;
  - the vendor's own calls it lets Tagma switch (its title call, its compaction).
- **Ask** — one question to a model outside a chat turn: instructions and input in, text or a structured answer out. A **fresh** ask is served by the provider's ask path. An ask **over** a thread is served by that thread's transport, reading the thread's warm context.

## Shape

```
feature (translation, titles, recap, decisions, compaction summaries, anything later)
   │  asks: selection + question          │  asks over thread X
   ▼                                      ▼
ModelAsks (providers)                ThreadAsks (threads)
   │  provider's declared ask path        │  thread's transport: aside capability
   ▼                                      ▼
request (HTTP) · program (CLI one-shot) · session (ACP)      native capture · vendor side question
   ▲
adapter package: provider + offer (+ CLI surface, ACP surface, runner)
```

A feature names only the user's choice — a model row from the one picker — and what it needs: text or a schema, fresh or over a thread. The provider package decides the path, the program, the flags and the cache policy. The core (`packages/agent`) already names no vendor. This work makes the server's features and composition name none either.

## Parts

1. **Features ask through one door** (child spec). It adds the `asks` declaration to the adapter contract, `ModelAsks` and `ThreadAsks`, the single "can answer an ask" predicate and one picker. It moves translation, titles, recap, decisions and compaction summaries onto them, and removes `roads.ts`, `DecisionModels` as a server service, and `HarnessLaunch.oneShot`.
2. **A CLI or ACP agent is an adapter package** (child spec). It moves vendor rows, ACP profiles and runners into packages. Shared vendor code becomes host modules. Harness names come from the registry. Births check installation, and declarations are checked against implementations.

**Order.** Part 1's first task lands the `asks` field of the adapter contract (`packages/tagma/src/adapter/provider.ts`). After that the parts run in parallel: Part 1 changes features and the ask doors, Part 2 changes `external-harnesses` and the vendor packages. Part 2 carries each vendor's ask declaration into its package when it moves that vendor. A file both parts must change goes to one owner at a time.

## What stays

- The native chat turn keeps `ModelAccess.request` with streaming and tools. That is the native transport's own path, not an ask.
- Image generation already follows this shape: the provider declares image models and its own profile draws (`providers/images.ts`). It stays.
- Speech providers stay outside this work.
- The thread engine and its transport contract (`packages/agent/src/thread/transport/contract.ts`) keep their shape. Their capability values become truthful (Part 2).

## Decisions this overturns

- The translation spec's "a translation act runs on a background thread" and its choice "a translation is a thread, not a model call". The act becomes a fresh ask through `ModelAsks`. Its picker is the one picker, filtered to providers that answer asks, so every row it offers translates.
- The task about titles, recaps and decisions as background threads. It is replaced by Part 1.

## Acceptance (whole work)

1. No server code outside `providers` and the vendor packages names a provider id or a CLI.
   - `translations`, `threads/naming`, `threads/recap` and `threads/decisions` import only the `ModelAsks` and `ThreadAsks` contracts for model answers.
   - `external-harnesses` holds no vendor directory.
   - An enforced import check proves both.
2. Every model row any ask picker offers answers a fresh ask, and nothing that cannot answer is offered.
3. A machine with one way in — an API key, a ChatGPT subscription, Claude Code alone, or a test CLI alone — gets translation, titles and decisions wherever its package declares an ask path. Where it declares none, those features say so once instead of failing on a pick.
4. A CLI package installed with `install_adapter` becomes a `harness:<id>` thread with no server change. Removing a builtin vendor's entry from the builtin adapter list leaves the server type-clean.

**Proof.** Each child names its integration tests through the real doors (`translate_block`, `generate_thread_title`, `create_thread`, `install_adapter`, settings writes) with scripted providers: one wire, one test CLI program declared by a test adapter package. Each child also names its enforced import check. The operator's own trial is no acceptance condition.
