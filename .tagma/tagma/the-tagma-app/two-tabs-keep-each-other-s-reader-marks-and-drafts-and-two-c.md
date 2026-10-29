---
id: 01a0e087-901b-7589-aa64-85eb084b01ec
title: Two tabs keep each other's reader marks and drafts, and two concurrent settings intents do not release the composer early (findings F005, F006, F007)
ord: 43
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e087-c7af-7edf-856d-11c356b8dc3e",
    "status": "done"
  }
---
From the architecture findings register (`spec-findings.md`). App-only.

- **F005.** `app/src/lib/features/reading/ReaderMarks.svelte.ts#KeptRecord:5,13-29` writes the whole JSON map from each tab's stale copy: tab A writes X, tab B overwrites with its old map plus Y, X is lost. Fix: per-key or merge-on-write storage so independent marks survive.
- **F006.** `app/src/lib/features/harness/DraftStore.ts:32-38,47-52,94-105`: per-key draft bytes plus a last-wins `tagma.drafts` index; tab B rewrites the index without A's key, so A's draft exists but reads null after reload ([[d48ef34b]]). Fix: the index cannot drop a key another tab wrote.
- **F007.** `app/src/lib/features/harness/HarnessHost.svelte.ts#writeModelSettings:1285` sets `busy='model'`; `/delegation` checks only its own tag (`:837-849`) and sets `busy=null` on finish while the model write is still running; `canSend` (`:304`) then lets a turn go with a half-applied combination. Claim [[ad85e6b7]] is broader than its sources. Fix: one owner of in-flight settings intents (a count or token set), `canSend` true only when none is in flight.

Done when: a test per finding reproduces the loss/early release and passes after, claims reconciled ([[ad85e6b7]], [[d48ef34b]]), commit names this task.