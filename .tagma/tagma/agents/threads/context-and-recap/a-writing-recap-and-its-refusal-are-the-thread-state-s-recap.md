---
id: 01a113e6-4734-7566-828c-c27ba3a7115e
title: A writing recap and its refusal are the thread state's `recapAttempt` field, same for manual and automatic writing
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/RecapAttemptCard.svelte
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/recap.ts
  - kind: file
    ref: apps/tagma/server/src/threads/recap/readings.ts
  - kind: file
    ref: apps/tagma/server/src/threads/recap/schedule.ts
---
A writing recap is visible in the thread feed from the server's state, not from the client that asked for it: so a manual `/recap` and an automatic write after a run show it the same way, and after reload or reconnect the snapshot carries the same attempt while the server lives.

- `writing` is set when the generator starts writing: manual — at once on launch, automatic — only after the fitness checks, before the model question. A screened-out automatic write (switched off, cooled, conversation moved) is not shown at all: the operator never asked for it.
- An attempt shown as `writing` ends in one of two ways: a published recap removes it in the same state publication where the summary appears, or its place is taken by `refused` with a code, reason and unblock. An automatic write displaced by a new conversation or a switched-off setting is removed silently.
- A manual request refused before writing starts (thread running, conversation index lagging, nothing said yet) also lays down `refused` when there is a said message to anchor; so the client shows its own notice only for a delivery failure, not for a gate refusal. A `recap-running` refusal on already-running writing does not overwrite `writing`.
- A new run (not keep-warm) and a thread offload drop the attempt: the refusal belongs to a conversation that already moved.

The anchor is the `entryId` of the message the recap will stand after (the held copy's basis, otherwise the last said), so the progress card stands where the summary will later land. The state lives in `ThreadRecaps` memory and is lost on server restart.
