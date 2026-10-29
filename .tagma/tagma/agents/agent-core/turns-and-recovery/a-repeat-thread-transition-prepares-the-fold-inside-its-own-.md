---
id: 01a13635-e91a-7a7a-94ed-26ec59b927cd
title: A repeat thread transition prepares the fold inside its own record, so a writing thread cannot starve it
ord: 5
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/agent/src/thread/transition/kernel.ts
    symbol: transition
---
A repeat thread transition prepares the fold inside its own record, so a writing thread cannot starve it. The first `transition` attempt prepares outside the lane and record to avoid holding the thread record during a read; when the thread version moves the attempt is stale. Every repeat prepares again inside its own write-unit, where the version cannot move, and reaches `decide` even when waiting on the first record already spent the transition patience. The first attempt goes there at once too when storage could not read a still snapshot (`readAt` answers `ThreadVersionStaleError`).

Without this, a thread writing continuously (a running run streaming steps) moved the version under every outside preparation, and the transition spun to `TRANSITION_PATIENCE_MS`, answering "the thread kept moving until the deadline". That is how `set_agent_model` lost the continuation-opening race to a wake on admission-hold release and failed, although the model was already written and the child ran on the new one.

Cost — a repeat holds the record during preparation (reading the whole thread history) — one measurement on the operator machine: a 4 MB history reads and parses in 20–130 ms. The transition patience bounds only repeated `redeclare`; the lane wait belongs to the lane itself. A transition refusal speaks only of the thread journal write: it never cancels a file act the tool already executed.
