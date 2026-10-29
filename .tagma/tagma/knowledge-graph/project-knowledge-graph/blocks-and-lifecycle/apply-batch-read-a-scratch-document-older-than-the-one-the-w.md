---
id: 01a0cfc2-860a-76c3-a7b3-6850cb5bf93d
title: apply_batch read a scratch document older than the one the write and edit doors had just reported written
ord: 18
tags: ["reflection"]
fields:
  {
    "actual": "The first call right after a successful write refused NotFound, although `ls` showed the file seconds later. After the edit that wrapped the array, the next call refused `bad-document: bare operations array`, while `jq` on the same path read an object with 17 ops. An unchanged third call succeeded. Cost: two refused calls and one shell check in one reconciliation.",
    "command": "write reconcile.json in the scratch folder, then apply_batch file=reconcile.json; then edit the file to wrap it as { \"ops\": [...] } and call apply_batch on the absolute path",
    "expected": "apply_batch reads the bytes the write or edit door has just reported written"
  }
---
Verified 2026-10-11 through a separate tagma:try build 5415a3bbb2-dirty 20261011T195435661Z: a newly written scratch file is read by apply_batch at once; after a typed edit of the same path the corrected document applied on the first call. In this sequential scenario NotFound and stale-read did not reproduce; the original setup and its load were not modeled. Work: [[0db0e31b|scratch freshness check]].
