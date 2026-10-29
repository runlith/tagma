---
id: 01a1645b-9da7-7fce-82eb-9b6e2fa8d937
title: A thread title first asks the warm snapshot, and without one an excerpt through the shared chain; an external thread with no CLI title is named at turn start
ord: 13
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/naming/generate.ts
---
One title first asks the live `ThreadAsides` snapshot: a question over it costs a fraction of an excerpt, because the prefix is already cached. The snapshot lives until the cache TTL (with no promised TTL — until the run ends) and is stale after a model or account change; then, with no snapshot and after a rejected answer, an excerpt runs on the model picked by the shared chain in the title role ([[db7ababc]]), and the reason for dropping the snapshot lands as the first rejected `warm` road. On an ACP thread the snapshot is the Claude session itself ([[f3949b43|side question]]): it answers with the current selection, so no model and account reconciliation applies. When no road fits, auto-title keeps the random name, and the next turn with different operator words retries (the claim is released on the words' text).

Without `threads.harnessTitle` an external thread's auto-title runs as an excerpt at turn start, once the operator's words are recorded: the ACP driver — on the recorded turn start, the terminal one — on the run-start event. So the name arrives while the turn runs, like a native thread's, whose question is asked on the model's first answer. An external thread's auto-title with `threads.harnessTitle` does not start an excerpt: a generated name would pre-empt the CLI title and stay forever, because accepting a CLI title replaces only a random name or a previous CLI title. The ACP Claude runner re-reads the session file after every `assistant` and `user` message and at turn end, and sends `session_info_update` with a new `ai-title`: Claude Code writes it before the first turn's answer, and reading only at turn end would hold the random name for the whole first turn.
