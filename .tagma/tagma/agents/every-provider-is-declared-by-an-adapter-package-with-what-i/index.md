---
id: 01a18cbf-8498-75d8-913f-c74f6f376186
title: Every provider is declared by an adapter package with what it serves, and every feature asks through one door without knowing which provider answers
ord: 102
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0fd8b-beed-7934-884b-a443f92da92b
  - kind: relates
    to: 01a0fd8b-bf09-7bd4-86c2-a17f287a4906
  - kind: relates
    to: 01a18cab-8c51-72ae-a0eb-1a8d08285d75
---
**Outcome.** Every provider is declared by an adapter package together with what it serves. A feature asks for a model answer through one door and never learns which provider, transport or program answers. A user with only an API key, only a subscription, only a terminal CLI, only an ACP agent, or only a builtin SDK-driven vendor gets every feature their one way in can serve. Anything it cannot serve is never offered, and Tagma says so once, at the place it would have been offered. A package may declare several providers, for example a vendor's API key, its subscription and its CLI. Dropping one path, such as a provider removed from the public build for its terms, drops that provider and leaves the package's other providers in place.

**Why.** A reading of the whole agent stack on 2026-10-30, checked by two independent reviews, found one ask served many ways:

- **Two owners of "callable".**
  - The catalog lists every provider, wire and harness alike (`providers/registry.ts:131`).
  - `ModelAccess.request` reaches wire providers only (`providers/access.ts:22-39`).
  - So the pickers of `translation.model`, `threads.titleModel` and `threads.decisionModel` (`app/.../providers/choices.ts:14-26`) offer rows that every call then refuses. That is the `claude-code:claude-haiku-5-5` translation failure.
  - The summarizer chain has the same gap: `callable()` tests only `auth !== 'cli'` (`native-harness/models/spendability.ts:10-12`).
- **Side calls know vendors.** Titles, recaps, decisions and translations pick their model through a six-road chain (`threads/roads.ts`) whose roads are vendor features:
  - a light model only on wire providers;
  - a one-shot program only for Claude Code (`HarnessLaunch.oneShot`, fixed to Haiku 4.5, input in argv, stdin ignored, 60 s deadline: `sessions/oneShot.ts:19-20,74`);
  - a side question only on a warm Claude ACP session.

  Each feature also has its own refusal: `title-model-missing`, `recap-unavailable`, `no-model`, `translation-model-missing`. A user whose only provider is a Cursor, OpenCode, Devin, Grok or Gemini harness therefore gets no title from Tagma, no recap and no decisions.
- **CLI vendors are a closed list in the server.** Wire providers are packages, including machine-installed ones: Muse OAuth is `@runlith/adapter-muse-oauth`, installed with `install_adapter`. A CLI, by contrast, is spread over the server:
  - `HARNESS_NAMES` (`threads/contract/wire/harness/names.ts:4`);
  - the `ADAPTERS` table (`external-harnesses/contract/service/table.ts:26`);
  - vendor rows under `external-harnesses/vendors/*`;
  - the closed `HookFormat` tuple and its branches (`contract/service/adapter.ts:13-14`, `adapter/hookFormat.ts`);
  - the metadata table (`metadata/table.ts`);
  - the hook process's `--harness` literals (`cli/hook.ts:21`);
  - the runner switch (`cli/harnessRun.ts:16`);
  - hand-written setting key lists (`external-harnesses/settings.ts:23-29,48-55`), where the hosted `cursor` key can never take effect;
  - the app's `HARNESS_LABELS` imports.
- **Two behaviours wrong for users.**
  - A birth accepts a CLI that is not installed (`external-harnesses/serving.ts:17-18` registers all seven names).
  - A CLI's own title call is paid for and then discarded when `threads.autoTitle` is off: launching reads `threads.harnessTitle` alone (`protocol/launcher.ts:176-178`), while taking the title reads both settings (`external-harnesses/assembly.ts:197-199`).

## Words

- **Thread** — the chat where a person and an agent work. Only that. Keep-warm and compaction are runs inside a thread. An ask is not a thread.
- **Provider** — one way in to models, declared by an adapter package: its identity, accounts, catalog and **offer**.
- **Offer** — what the provider serves:
  - the transports its chats run on (`native`, `acp`, `terminal`);
  - the **kinds of ask** each of its models answers (text, object, decision);
  - the vendor's own calls that Tagma may switch (its title call).
- **Ask** — one question to a model outside a chat turn: instructions and input in, and text, an object or a decision out.
  - A **fresh** ask runs on the chosen model through its provider's ask path.
  - An ask **over** a thread runs through that thread's transport on the thread's warm context.
- **Ask path** — how a provider answers a fresh ask. There are two:
  - `request`: Tagma's HTTP call, available to every wire provider;
  - `program`: one process per ask. The input goes in on stdin and a typed answer comes out. A CLI's print mode is a program; a builtin SDK runner's `--ask` entry is a program too.

  A harness whose login a wire provider borrows (Codex, through the ChatGPT subscription in `codex` mode) answers through that wire provider.

## Shape

```
feature (translation, titles, recap, decisions, compaction summaries, anything later)
   │ fresh ask: selection + kind + question     │ ask over thread X
   ▼                                            ▼
ModelAsks (providers)                       ThreadAsks (threads)
   │ path the provider declares                 │ X's transport aside capability, warm only
   ▼                                            ▼
request (wire HTTP) · program (stdin → typed answer)    native capture · vendor side question
   ▲                         ▲
adapter package: providers + offer       AskPrograms port, filled by external-harnesses
```

A feature names only the user's choice (a model row from the one picker), the kind of answer it needs, and whether it asks fresh or over a thread. The provider's package decides the path, the program, its flags and the cache policy. The core (`packages/agent`) already names no vendor. This work makes the server's features and composition name none either.

## Parts

1. **Features ask through one door** ([[bcec10b7]]). Adds the offer's ask kinds and the `program` declaration to the adapter contract, `ModelAsks`, `ThreadAsks`, and one picker filtered by kind. Moves translation, titles, recap, decisions and compaction summaries onto them. Declares Claude Code's program on its existing provider in `packages/adapter-anthropic`, and Cursor's runner `--ask` program. Removes `roads.ts`, the `DecisionModels` service and `HarnessLaunch.oneShot`.
2. **A CLI or ACP agent is an adapter package** ([[57787448]]). Vendor terminal surfaces, ACP profiles, hook codecs and metadata readers move into packages. Harness ids come from the registry. A registry that changes at runtime keeps the chats of a removed harness readable. Births check installation.

**Order.** Part 1 lands first and whole. Part 2 then starts with steps that move no vendor, and moves vendors one landing at a time. Several files are shared by both parts: the one-shot fields in `external-harnesses/contract/service/adapter.ts`, `contribution.ts`, the Claude Code row and `sessions/oneShot.ts`. Part 1 removes those first. Running the parts in parallel would leave two writers on the same seam, and for a while no usable ask path for Claude Code users.

## What stays

- The native chat turn keeps `ModelAccess.request`, with streaming and tools. That is the native transport's own path, not an ask.
- A vendor's compaction of its own live session, and a provider profile's own compaction, stay where they are.
- Image generation already follows this shape (`providers/images.ts`) and stays.
- Speech stays outside this work.
- The thread engine and its transport contract keep their shape, including:
  - per-thread capability values in the seat (`birth/seat.ts`);
  - per-run vendor web on native threads (decision [[cccbfb07]]);
  - fork and rewind of hosted Cursor and OpenCode threads by rebuilding the session from the journal (`protocol/opening.ts:123-126`, `protocol/alignment.ts:119-121`).

## Decisions this overturns

- The translation spec's background-thread act ([[1d5f53a4]]), and the closed tasks about background threads. A translation is a fresh ask.

## Acceptance (whole work)

1. No vendor id or CLI name appears in the feature directories (`translations`, `threads/naming`, `threads/recap`, `threads/decisions`, `native-harness/compaction`), nor in `external-harnesses` outside its `steps/`. An enforced string inspection proves this, with named exemptions:
   - `external-harnesses/steps/` (journal-shape steps, rule [[a4d62ee7]]);
   - `composition/adapters.ts`;
   - `plugin-formats/` (plugin marketplace formats, a different subject);
   - `editors/` (Cursor the editor);
   - test fixtures.

   An enforced check of calls ([[93f04f23]]) keeps every other server file, including any later feature, from asking a model outside the doors.
2. Every model row an ask picker offers answers that picker's kind, and nothing that cannot answer it is offered.
3. A machine with one way in gets translation, titles and decisions through the path its package declares:
   - an API key;
   - a ChatGPT subscription;
   - Codex alone, through borrowing;
   - Claude Code alone, through its program;
   - a test CLI package alone.

   Where nothing is declared, each feature says so once.
4. A CLI package installed with `install_adapter` becomes a `harness:<id>` chat with no server change. Its removal leaves its chats readable.
5. With one builtin vendor's package removed from the server's dependencies and host modules, the server builds and boots, and none of that package's code ships.

**Proof.** Each child names its integration tests through the real doors (`translate_block`, `generate_thread_title`, `compact_thread`, settings writes, `install_adapter`, `create_thread`) and its conformance suites, with scripted providers: a wire provider, and a test adapter package whose program is a local script. The operator's own trial is no acceptance condition.
