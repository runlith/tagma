---
id: 01a19106-4880-7b2f-b011-ba9b603d97d7
title: A run's stream tail reads the journal only for open tool inputs; its text parts are landed by the transitions that record them
ord: 25
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a18cde-5f93-73e8-aa31-64572afe6fec
sources:
  - kind: symbol
    ref: packages/agent/src/thread/run/lifecycle/RunReports.ts
    symbol: runReportsLayer
---
`RunReports` writes a run's open parts as its `stream_tail` and leaves out the parts the journal already holds. A text part (message or reasoning) reaches the journal only through the run's own `recorded` transition. That transition lands the part's id from the tails after commit, on replay too. So a text part still in the tail is open unless the same unit wrote it, and those ids are remembered per unit instead of read back. That covers a `recorded` followed by an `ended` inside one program, where the commit has not yet landed them.

A tool input can be journaled by another writer: hosting writes the hosted call's record. Only tool inputs are still checked against the journal.