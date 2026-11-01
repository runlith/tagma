---
id: 01a198b7-f0e9-795a-ae91-a3feb165d381
title: A successful worktree merge cannot write its thread receipt
ord: 193
tags: ["reflection"]
fields:
  {
    "actual": "The merge published 0919a4501f2f155264604ef019551198159f3eca but left no receipt because writing the thread's merged note failed with SQLite constraint trigger 'undeclared row projection: threads.native'; its witness stays open until the next server start.",
    "command": "merge_worktree({rootId: \"01a198ae-5989-7575-a042-fcb6954f020d\", mode: \"merge\", message: \"Merge core pin 2c73c957b0 and demo compatibility\"})",
    "expected": "The merge publishes its commit and records a receipt and merged note for the calling thread."
  }
---
Filed from project `runlith`. Received by a server up since 2026-11-01T19:32:43.457Z, from 554abb6a7.

The operation answered `status: merged` and reported the failure under `unrecorded`, after moving the base branch. The failed statement was `update "native_thread" set "updated_at" = ? where "native_thread"."id" = ?` in thread storage append.