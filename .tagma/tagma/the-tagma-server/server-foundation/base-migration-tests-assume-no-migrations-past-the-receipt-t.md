---
id: 01a13189-d131-7747-996e-df44c0630f28
title: Base migration tests assume no migrations past the receipt tail, and fail with every new migration
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13177-2aab-785c-bb16-e1ebccf34651",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/baseline.itest.ts
  - kind: file
    ref: apps/tagma/server/src/platform/store/baselineTail.itest.ts
---
In `drizzle/baseline.json` the tail holds 8 migrations, and in `drizzle/` past the base there are 16. Later landed, among others, `20261011212409_submit_merge_tail`, `20261011231753_adapter_instance` and `20261012090525_provider_selection`. Seven tests compare the local chain or an opened store's schema against `receipt.tail` and fail on HEAD.

- `baseline.itest.ts`:
  - "a fresh store has the baseline schema…" — digest against `receipt.tail.at(-1).schema`;
  - "a source store at the cut translates…" — pending against `receipt.tail`;
  - "translation preserves an applied following prefix of 1 / 8…" — both;
  - "a committed translation retires its folded snapshot…".
- `baselineTail.itest.ts`: both variants of "the full tail keeps only the running receipt…".

A receipt is a one-off snapshot at chain-fold time. New migrations never enter it and must not. Test expectations derive from the local chain: pending is local migrations past the applied tail. The schema reconciles with a store that ran the same chain, not with a receipt fingerprint.

Done: both files pass on the current chain and keep passing after one more migration lands.
