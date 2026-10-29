---
id: 01a0d0d5-44a0-7ab4-b2f7-b4e5e7d9f2d1
title: apply_batch reads a scratch document written moments before as it was before the last edit
ord: 173
tags: ["reflection"]
fields:
  {
    "actual": "Three times in one session apply_batch refused on text the preceding edit had already replaced (anchor-noop, anchor-not-found, and a NotFound for a file just written); the same unchanged call succeeded on retry a few seconds later",
    "command": "edit on a scratch batch file, then apply_batch on the same path immediately after",
    "expected": "apply_batch reads the file as the edit left it"
  }
---
Verified 2026-10-11 through a separate tagma:try build 5415a3bbb2-dirty 20261011T195435661Z: a typed write created a file in a new ws/deeper scratch; apply_batch on the bare array refused bad-document; a typed edit fixed the same path; the next apply_batch answered status=ok at once. Stale-read did not reproduce in this sequential scenario. BatchFiles reads the file through the Node FileSystem on every call; the historical cause and the original setup's state are not established. Work: [[0db0e31b|scratch freshness check]].
