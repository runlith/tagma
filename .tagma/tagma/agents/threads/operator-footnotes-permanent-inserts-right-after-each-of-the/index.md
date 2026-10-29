---
id: 01a140eb-0a34-75f6-93a0-7be7450e145e
title: "Operator footnotes: permanent inserts right after each of their messages, managed by the agent on their word"
ord: 53
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a118eb-3e7e-7085-8f2e-2cd3bb429da3
  - kind: relates
    to: 01a11c9a-6edb-7ed8-b517-60ac9116e494
  - kind: relates
    to: 01a11c9a-6edb-7ed8-b517-60ad2121a95f
---
The operator keeps a set of footnotes — short texts the model receives right after each of their messages, though they never write them. The agent manages the set on the operator's word: "add this to my messages", "remove it", "switch all footnotes off, built-ins too", "put it back as it was". The product ships a built-in "hold-the-line" footnote — hold the line under pressure; it switches off like any other.

## What the user gets

- A rule standing next to each of their words, not at the context's start where later messages outweigh it.
- Management by words: the agent changes the set with an operation and names what stands now.
- Scope of choice: whole machine, project, or one thread.
- One semantics on every road: the footnote goes right after their words — on native, on ACP, and, where the vendor allows it, in terminal CLI.
- Footnotes pollute neither thread search nor the compression retelling.

## What stands today (read in code, 2026-10-15)

Model-context inserts travel two guidance channels of one `runtime-guidance` record ([[2121a95f|the transport contract]], "What was said to the agent"):
- **Step rules** — the `AgentRuntimePolicy` pipeline (`agentRule(id, ctx → guide | null, {owner, hook, priority, critical})`) on `beforeStep`, `beforeTool`, `afterTool` hooks. Executes on native and on hosted ACP (the Claude runner), which evaluates rules at turn opening and after each call ([[8e0f35a1]]). The guide is written to thread history (`events.ts:436-444`) and goes to the model as a `guidance`-origin message. This is how project law, delegation, and touch rules arrive.
- Core **`RunGuidance`** — the `prompt` channel (ACP turn lead: `protocol/prompts.ts:145-152` assembles `[guidance…, words…]`) and the `hook` channel (terminal CLIs via `guide_harness`).

No channel carries anything to every operator message. Thread search reads only spoken messages (`threads/journal/conversationReads.ts`); guidance records do not enter it. The app shows `runtime-guidance` records as an activity row in verbose mode (`chat-ui/builtinKinds.ts:67`, `verboseOnly`).

## Decision

No separate channel and no separate "inserts" notion over guidance is needed: the generalization point already exists — step rules plus `RunGuidance` with the shared `runtime-guidance` record. Footnotes are a new "what is due" item on both channels, with one owner making the text:
- **Set and text** — the `OperatorNotes` owner in the `threads` module: scopes, switches, budget, one render for all roads ([[f4702e26]]).
- **Delivery** — the `operator-notes` contribution to step rules for native and the footnote tail on the `prompt` channel for ACP: the operator's words leave for the vendor only through the driver, and the footnote rides in the same message after them ([[1d74527f]]).
- **Terminal** — the `hook` channel, after probing each CLI ([[49ca1849]]).

A future insert of the same kind is a new contribution on the same channels, not a new mechanism.

## Parts

- [[f4702e26]] — the footnote set, scopes, built-in contributions, budget, render, and operations.
- [[1d74527f]] — native and ACP: moment, position, cache, compression, and turn accounting.
- [[0815fb9f]] — the built-in "hold-the-line" footnote and the doctrine section it repeats.
- [[49ca1849]] — terminal CLIs via the prompt-submit hook.

Build order: [[f4702e26]] → [[1d74527f]] → [[0815fb9f]] → [[49ca1849]].

## Outside this spec

- out: a separate footnotes row in the context-window breakdown — they count in the `guidance` part, like any guide.
- out: footnotes on agents' words (parent tasks and messages) — the set serves the operator's words; see the idea below.
- [[e8ba4977]] (merge `ThreadRunClosing` into the rules pipeline) and [[dbba1d1b]] (one `ThreadContext` for orientation and run) survive: footnotes neither change them nor depend on them.
