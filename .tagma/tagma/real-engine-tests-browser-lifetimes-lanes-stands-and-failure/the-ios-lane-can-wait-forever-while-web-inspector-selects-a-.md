---
id: 01a1b1be-306e-76e7-8d86-dab1888e2161
title: The iOS lane can wait forever while Web Inspector selects a fresh Safari page
ord: 15
tags: ["task"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: packages/e2e/src/lanes/ios.ts
---
In e2e run 42248081046 (`packages/e2e`, iOS 26.5 on the macOS runner) "MobileSafari preserves native momentum until a page write stops it" reached "iOS native accessibility ready for Safari 11424", then the remote debugger logged two applications as "not connectable yet" (one with an empty page dictionary) and a skipped `Target.targetCreated` of type frame, and nothing more until the 180 s test bound fired. Page inspection selection or the setup's first `open('about:blank')` has no fact that ends it when Web Inspector never answers. The three nested contract scenarios before it passed in the same run.

Find which await stood (connect, `selectApp`, `selectPage` or `Page.loadEventFired`) from the run's artifacts and end the wait on a fact the lane owns — the page appearing, the application leaving, or a refusal naming what Web Inspector reported.