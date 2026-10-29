---
id: 01a11737-2f89-70a1-b640-933683c2055b
title: Who works through architecture debt, and when
ord: 3
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a11711-4dcd-7632-8e3a-0520973f059a
---
Question: an agent stopped by the gate now records the violation as debt with a task to fix up the area, but nobody works through such tasks — the 700-line rule's debt-owner tasks stand open and nobody takes them. Without someone working through it the debt only accumulates.

Discussed:
- a scheduled (cron) worker — rejected: spends money blind and reworks architecture nobody discussed;
- event-driven triage — new debt or several debts in one area reach the operator in human words, the operator answers only "now" or "later"; "now" starts an architecture agent who first reads the area and writes a diagnosis and plan with no code, reviewers check the plan, the operator gets an explanation, then implementation. That would also close the visibility of new debt for the operator.

Unclear: whether a triage mechanism is needed at all, what counts as an "area is structured wrong" signal, and how an operator who doesn't read code picks "now" or "later". No decision.
