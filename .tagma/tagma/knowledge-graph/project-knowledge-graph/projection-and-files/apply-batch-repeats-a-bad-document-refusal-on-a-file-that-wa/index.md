---
id: 01a0cbc6-ed92-7f99-a08e-c632ef21c1ec
title: apply_batch repeats a bad-document refusal on a file that was corrected after the first refusal
ord: 19
tags: ["reflection"]
fields:
  {
    "actual": "The second call answered the identical `bad-document: … not a bare operations array` refusal although the file on disk began with {\"ops\": [ (checked with head). The same ops passed inline as `source` applied at once.",
    "command": "apply_batch file=<scratch>/modules/batch.json — first as a bare array, then after rewriting it to {\"ops\": [...]}",
    "expected": "The second call reads the corrected file at call time, as the tool description promises, and applies the seven updates"
  }
---
Filed from project `runlith`.

Measured 2026-09-23 on thread 01a0c931. The refusal's recovery contract ("edit the input file, then pass that path") is exactly what failed, so an agent following it loops. One extra call and a switch to inline source were the cost here.

Verified 2026-10-11 through a separate tagma:try build 5415a3bbb2-dirty 20261011T195435661Z: apply_batch refused on the bare array; a typed edit wrapped the same file into an ops object; the next apply_batch applied it at once. The repeated bad-document after the fix did not reproduce in this sequential scenario. The original setup and its load were not modeled; the historical cause is not established. Work: [[0db0e31b|scratch freshness check]].
