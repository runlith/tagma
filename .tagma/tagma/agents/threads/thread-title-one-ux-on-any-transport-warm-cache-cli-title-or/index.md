---
id: 01a110fc-e0c2-7923-9ec8-1772a6f1d19e
title: "Thread title: one UX on any transport — warm cache, CLI title, or a light-model excerpt"
ord: 14
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/settings.ts
  - kind: file
    ref: apps/tagma/server/src/threads/naming/generate.ts
---
The root thread title is led by Tagma with one UX on any transport (native, ACP, terminal); only the road to the model differs.

## UX

- "Name threads automatically" (`threads.autoTitle`, on by default) — a randomly named thread receives a title after the operator's first message.
- "Generate title" — always regenerates, on any transport.
- "Rename" — a manual name.
- The "Use … title" item and the `adopt_thread_title` operation are removed together with their code (on-request CLI title read, `readTitle`, `adoptTitle` of the `Harness` port).

## Settings

| Key | Default | Meaning |
|---|---|---|
| `threads.autoTitle` | `true` | as now |
| `threads.harnessTitle` | `true` (was `false`) | "Let the CLI name its threads": the outside thread's auto-title is given by the CLI itself; when off, Tagma's generator gives it. Does not affect "Generate title". |
| `threads.titleModel` | `''` = Auto | excerpt model; when set, always that one |
| `threads.titleReasoning`, `threads.titleCharacters` | as now | excerpt rung and budget |

## Choice for one title

1. **Warm cache** — a native thread with a live snapshot (`ThreadAsides`: same model and account, within the cache TTL): the thread model's question over the cache. For both auto-title and "Generate title".
2. **CLI title** — only an outside thread's auto-title at `threads.harnessTitle`: the title reported by the CLI is taken (`ai-title` from Claude Code through the existing admission in observations). The ACP Claude runner passes `title` into the Agent SDK only when the setting is off — otherwise Claude Code does not generate a title.
3. **Excerpt** (`titleContext`: the operator's words, start and end, within `titleCharacters`), model in order:
   1. `threads.titleModel`, when set;
   2. the thread provider's light model, when the provider is connected — the provider catalog declares it (new provider-description field) with a low rung; for an outside thread the provider is the serving model's family (Claude Code → Anthropic);
   3. a one-shot CLI call of the thread with no session — for Claude Code `claude -p --model <light> --no-session-persistence` with no tools, settings, or MCP; works for ACP and terminal, no thread process needed;
   4. a native thread's model at the lowest rung.
4. Nothing fit: "Generate title" refuses with a typed refusal with `unblock` "pick a Title model in settings"; auto-title keeps the random name.

The hard-wired `ExternalTitleModel` (Opus `xhigh`) is removed.

An outside thread's auto-title at `threads.harnessTitle` off fires at the end of the first turn with operator words — one point for ACP and terminal, with the same `claimTitleInput` as native.

## Check

- Probe of 2026-10-06 (Claude Code 2.1.291, Agent SDK 0.2.114, Haiku): without `title` Claude Code writes `ai-title` on the operator's words and ignores the turn-context block; a separate request is ~1k tokens; the second turn reads the main prefix from cache whole.
- itest for model choice over steps 1–4 and the step-4 refusal; itest for the outside-thread auto-title at `threads.harnessTitle` off.
- A live ACP-thread run in both `threads.harnessTitle` positions and "Generate title" on native, ACP, and terminal threads.
