---
id: 01a16ac4-44bf-7e0a-8178-b7066852d8d4
title: "Tagma accepts any runner's test-run report: budgets as rules, debt with an owner, affected tests on landing"
ord: 8
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
---
**Question.** Does Tagma accept a test-run report from any runner — pytest, jest, go test, cargo, bun — and turn it into what no runner has: layer budgets as rules with debt and an owner, graph-module-based affected-test selection, running them on landing, and telling an agent what to run and what it costs?

**Motivation.** Slow tests stall agents' work in any project with code, not just runlith. Tagma already has the rules mechanism (check → note/watch/gate strictness → debt on a task) and the module graph, but rules judge only code trees: test time is a run measurement, and it has nowhere to become a finding. At runlith the budget therefore lives as a stderr line.

**What the choice resolves.**
- The report contract almost any runner already gives: most have JUnit XML with timing; is it enough, or is a custom format needed with setup-vs-body split and the resources the test touched.
- Where a dynamic finding lives in Tagma: in enforcement beside code checks, or as a separate entry.
- How landing runs tests without turning `submit_work` into a long step: change-based selection and caching are mandatory.
- The answer to [[7a4ff805]]: a Tagma that selects a subset of someone else's runner's tests at landing decides for someone else's tool. A possible boundary: Tagma only reads the report and names what is affected, while the runner itself runs them with its own command.
- The [[38ef1770]] experience at runlith: what of the kit and the report proved shared, and what proved knowledge of our stack (Bun, TypeScript, Effect).

**Uncertainty.** Whether this ability is needed by users who write no tests or few, and whether the budget becomes bureaucracy for them. For projects with no code it is not needed at all, so this is a software-development catalog ability, not a core one.
