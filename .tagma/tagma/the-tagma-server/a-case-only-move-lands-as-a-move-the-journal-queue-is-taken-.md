---
id: 01a1502a-fc79-7600-8da6-a04f5c0b49e2
title: "A case-only move lands as a move: the journal queue is taken on a set of places, the directory-record write place carries its own spelling, held failures name themselves"
ord: 135
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14ffe-7720-7464-9ab4-d5fd0b33fcf5",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14ffe-673f-7ade-b747-4f15604db4d1
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/record/intake.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/paths.ts
  - kind: file
    ref: packages/agent-tools/src/changed.ts
  - kind: file
    ref: packages/held/src/failures.ts
---
`rename theme.svelte.ts → Theme.svelte.ts` on a case-insensitive filesystem hangs 60 s and fails with `"[rename] error: "` ([[604db4d1]], [[a4dd5673]]); after the bypass git sees no move ([[47768c8f]]). Holdings judgement already distinguishes spelling ([[c04c7b50]]).

Causes:
- `CheckoutPaths.spelled` brings the leaf to the on-disk spelling through realpath, so the `Theme.svelte.ts` destination coincides with the `theme.svelte.ts` source place: the write fact lands on the old path, not the new one.
- `inTurns` (agent-tools) and the operator move (`checkout-files/entries/record.ts`) each put one `Intake.turn` queue per path; two spellings of one place take one `Semaphore(1)` twice — a self-lock until the 60 s hold ceiling.
- `HoldCut`, `HoldStalled`, `ReentrantCall`, `CapacityBusy` (`packages/held`) carry no `message`: whoever does not translate them gives an empty reason ([[ecafcea1]]).

Do: the directory-record write place is the canonical parent plus the leaf as named; `Intake.turn` takes a set of paths and holds one queue per place, in key order; held failures carry a message with resource, key, time, and what the break leaves behind.

Proof: itest — the `rename` tool with a case change answers in a fraction of a second, the journal holds the old deletion and the new-spelling write with `movedFrom`, `submit_work` lands the move (new name in HEAD, old gone, index consistent).
