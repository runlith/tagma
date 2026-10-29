---
id: 01a0e532-cc6c-73df-a111-c28429ce4645
title: "threads M2: map applied"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e5c4-94b9-7fed-bbb0-6060db0ffafa",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-c806-7806-be5d-983121d8b775
  - kind: waits-on
    to: 01a0e532-c828-7195-a4be-9fc6f3aa2e7e
  - kind: waits-on
    to: 01a0e532-cc63-7cd6-8936-6e61092bdeb0
---
§7.2.2 milestone `M2` of the `threads` card ([[f7e0b9dd]]), with its vocabulary amendment [[aa1b0681]]. The `src/doctrine/sectionText.ts` scanner and its test move with that directory into `threads/doctrine/`; keep the root `tagma:typecheck` lane's scanner-test invocation on the new path. D0 ([[b5977128]]) advances rollout generation in full exports, repair and harness compression/wake, preserving projection offsets for byte-preserving transforms; legacy read-only decompression never writes the cursor. D3's common lane completes transform counting and per-replacement generation retention. D4 ([[ae74039e]]) leaves the doctor pass over machine-store thread records to this milestone. No such pass exists today. It should report unscoped records and external records that keep a legacy native selection, which the card lists as the unscoped-record finding. Until the pass exists, D4's migration report table carries those findings. Until D3's journal rest lane exists, external threads rest through today's projection sweep (`ThreadRollouts.sweep` → `restingPast`), which reads their clock from `thread_record.moved_at`. D3's lane replaces that sweep for them.

HTTP route debt (from http M2 [[dd5ad950]]): threads owes operations for the `threads.*` routes that have none (create, roots, types, favorites, snapshot, locate, held, query, trace, seen, title, attachments) and for `grants.*` (permission rules), plus answer schemas on list_threads, read_thread, read_thread_record, read/repair_thread_rollout, archive_thread(s), pin_thread, move_thread, set_thread_delegation, generate/adopt_thread_title, refresh_thread_instructions, delete_thread, answer_ask and cancel_ask; each route then retires into `http/retired.ts`.