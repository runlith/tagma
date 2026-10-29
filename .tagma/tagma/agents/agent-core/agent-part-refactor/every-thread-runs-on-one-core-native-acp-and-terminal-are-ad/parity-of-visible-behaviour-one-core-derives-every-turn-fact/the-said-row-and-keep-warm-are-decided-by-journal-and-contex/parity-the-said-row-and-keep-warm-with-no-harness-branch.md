---
id: 01a14cf8-61d6-788c-a1bd-bf037fc75b4f
title: "Parity: the said row and keep-warm with no harness branch"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14cfa-0234-7f3c-a2f0-2b2c8b47b417",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14cba-e095-7bcb-bb6f-60847ecd38ad
---
Implement [[7ecd38ad]]: `saidLine` and the list summaries with no `harness === null`, keep-warm by the promised cache lifetime with `turnSpendability` for the CLI row instead of the `external` gate. Delivery: `b9a4345ef8` — implementation and the owners' checks; `e34a0cec72` — the parity scenario in the shared fixture. On HEAD the focused scenario passed: 1 test, 10 assertions, 21.54 s per file; native and ACP got a live-driver ping before the recorded cache lifetime expired, ACP recorded the signal and the `ok` answer. Earlier the list, quota, warmth, summarizer-choice, hosted-refusal and unopened-ping-close checks passed on memory and SQLite; the two reviewers' confirmed remarks are fixed. The full parity suite and the shared typecheck were not run on the final HEAD; working with the real Claude remains the operator's check.
