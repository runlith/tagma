---
id: 01a18d1c-7132-7117-85e4-a72a5a94659d
title: "A feature asks a model by the kind of answer it needs, and the model's provider decides the path: a request, a borrowing subscription, or a program on stdin"
ord: 26
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a18cbf-9775-75eb-a4a1-6542bcec10b7
  - kind: supersedes
    to: 01a11127-7009-727d-9639-b5f1db7ababc
sources:
  - kind: file
    ref: apps/tagma/server/src/providers/asks.ts
  - kind: file
    ref: apps/tagma/server/src/providers/registry.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/programs/asks.ts
  - kind: file
    ref: apps/tagma/server/src/providers/compactionAsks.ts
---
The path is the provider's, never the feature's: a feature names a model, the kind of answer and its input, and `ModelAsks` routes it. A wire provider answers by request. A harness whose login a wire provider borrows answers through that wire provider when it serves the same model — this replaced the catalog's `family`. Otherwise a harness answers through the program it declares (`asks.program` in its adapter package), or not at all. The kinds a model answers follow from that route and its capabilities alone, so the served catalog can publish them per model and a picker never offers a row that every call would refuse.

An explicit role setting is a promise: a model that cannot answer its kind refuses `ask-unanswerable` and is never swapped for another, because answering with a model the operator did not pick would deceive him. The setting's write already refuses such a model; the call-time refusal stays because a provider removed or disconnected later is not caught by the write. With the role empty, the default walks the decision models (for decisions), the asker's provider light model and own model at its lowest rung, the operator's saved default, then the first connected provider's light model. Each step needs the provider in the connected set `ProviderAccounts` keeps, which never starts a CLI the operator has not selected ([[41797cec]]).

A program takes its input on stdin and only its flags in argv, so a translation batch or a compaction segment is bounded by the model's window, not by the operating system's argument limit. An adapter declares either a program it names, with its own argv, or one of Tagma's builtin runners, whose ask flags `AskPrograms` writes beside the `harness-run` verb that reads them, so one owner holds both halves of that grammar. One budget — the model's input or context less the planned output — sizes `capacity` and refuses an oversized program ask before it runs; a program model that declares no context window answers nothing. It runs as a direct child on the account CLI runner, in an empty scratch directory so no repository instruction file is read, with the selected account's environment or the provider's default one, a deadline grown with the planned output, and a per-provider bound on concurrent programs derived from the machine; an interrupted ask kills it. An object ask on a program that takes no schema is answered as JSON text and parsed once; every object answer, on either path, is then checked against its JSON schema (`decodeJsonAnswer` in `@runlith/llm/call`, which `generateObject` uses too): an off-schema or unreadable answer is `ask-unreadable-answer`, with no repair round that would double the spend.

Compaction summaries reach programs through `CompactionAsks` (`providers/compactionAsks.ts`), which fills the core's `CompactionModels` on `ModelAsks.text` with the run's catalog pin and turns a program's refusals into the model failures the summary strategy and the summarizer chain already read — an overflow steps back to an earlier boundary, a quota falls through to the next member.
