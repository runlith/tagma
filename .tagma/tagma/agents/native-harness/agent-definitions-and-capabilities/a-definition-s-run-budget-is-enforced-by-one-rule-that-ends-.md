---
id: 01a1a8ee-a2f7-7844-b32e-d77050fc1530
title: A definition's run budget is enforced by one rule that ends the run on an answer step, never by a cut
ord: 8
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a11bc1-aec3-7d58-9aa1-ef82678b6045
  - kind: relates
    to: 01a1a889-59c9-7db6-bbee-b8fb1baf46ae
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/budgetRule.ts
---
A definition's `budget` bounds a run by prompt tokens, steps and seconds; the `run-budget` rule guides at 70%, then ends the run on one answer step. A thread whose profile overlay carries no `budget` is not gated at all; an unset `prompt` takes the model card's `premiumAbove`, where the card declares one (the prompt length above which a request pays higher prices), and is otherwise unbounded.

The gate reads the prompt from the context estimate the anchor hands every `beforeStep` — the thread's latest measurement plus an estimate of what joined since — so it holds no token arithmetic of its own and knows no vendor.

- **Prompt.** All calls of a step are judged together, before any of them runs, so a result's size is unknown. Each admitted call reserves the largest result a tool output can have, plus its own input, and the step is allowed an output allowance for what the model itself writes. A call that would not fit is denied with the rest of its step, and the next step is the answer step. The consequence is a run that ends earlier than the budget by about one maximal result; the price is that a request never exceeds the budget unless the model's own output passes the allowance.
- **Steps** count requests, the answer step included, so a budget of N ends in N requests. **Seconds** run from the first step the rule sees; a run recovered after a restart starts its clock again.
- **The answer step** is `restrict` to `answer` plus `require` of it. The pipeline makes this right on every catalog and card: a run without `answer` is restricted to no tool and the step's text is the answer; a card that cannot force tool use sends `answer` alone under `auto`. `answer` is granted by the call that births the thread; the gate only looks for the name and never denies it.
- **Closing.** A text-only finish in a run holding `answer`, with no `answer` called, is asked once to call it; the next finish is taken as the answer. A call to `answer` after a spent budget leaves the next step no tools.

The answer step is not a cut: the model still writes the answer, from the context it has. Cutting a run at the budget would lose it.
