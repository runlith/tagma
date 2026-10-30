---
id: 01a18cf1-4277-77ed-b6af-3214f1fc96ce
title: "Server: ModelAsks and ThreadAsks with request and program paths, features moved onto them, roads and one-shot removed"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18cf1-9ccc-73e5-a933-652fc49d6324",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a18cbf-9775-75eb-a4a1-6542bcec10b7
---
Build the server half of spec bcec10b7 as written:

- **Ask kinds.** The adapter contract carries a model's ask kinds and the `program` declaration. The served catalog derives each model's kinds (text, object, decision).
- **New services.**
  - `ModelAsks`, with the `AskPrograms` port filled by `external-harnesses`, the `DefaultSelection` port filled by `native-harness`, and borrowing resolution in place of `family`.
  - `ThreadAsks`, which answers with its basis.
- **Program declarations.** Claude Code's program on its provider in `packages/adapter-anthropic`. Cursor's runner `--ask` program, only if the Cursor SDK answers one prompt with no tools; otherwise declare none and report why.
- **Features moved to the new services.**
  - Translation, titles, recap (over only), decisions, and compaction summaries (`CompactionModels` filled for program-path members; the `foreign` own-provider exclusion lifted where the provider answers text).
  - Setting writes refuse a model that cannot answer its role's kind.
- **Removed.** Everything the spec's Removed section names, with its refusal words and notes.

The app side — one picker per kind, a settings control writing model and rung together, the translation strip's refusal words — is its own task. It takes the served kinds this task publishes.
