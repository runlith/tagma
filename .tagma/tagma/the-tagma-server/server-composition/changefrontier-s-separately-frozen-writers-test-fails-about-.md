---
id: 01a0d6b2-794b-7f64-8b4e-2a605fc50eab
title: changeFrontier's "separately frozen writers" test fails about one run in two, because it orders rows by a timestamp that can tie
ord: 31
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/change-record/changeFrontier.itest.ts
---
Seen on 2026-09-25 by speed-git. `files/changeFrontier.itest.ts`, test "separately frozen writers retain the original order of interleaved edits" (renamed since), failed one run in two when run alone, and once at `--parallel=2`. It still sorts rows by an `at` timestamp that two rows can share (`changeFrontier.itest.ts:48`).

Find whether the product's own order ties too, which would be a defect at the owner, or only the test's expectation does. Fix it where the order is decided.

**Done when** the test passes in 20 consecutive runs alone.