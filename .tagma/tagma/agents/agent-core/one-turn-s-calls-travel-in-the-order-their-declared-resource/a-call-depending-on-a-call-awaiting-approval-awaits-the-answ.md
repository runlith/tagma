---
id: 01a15113-e4c9-763e-bcc6-16aa39f5b617
title: A call depending on a call awaiting approval awaits the answer together with it instead of receiving a same-batch refusal
ord: 2
tags: ["idea"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ToolQuestion.ts
---
Question: should a call depending on a call awaiting approval await the answer together with it and execute after it in call order, instead of receiving a same-batch refusal?

Motivation. In review mode `write`, `edit`, and mutating `bash` ask. Per [[07c34834]] every later call intersecting one refuses and repeats on the next turn: an extra model turn and extra feed text. Resuming after the answer already executes approved calls one by one in call order (`thread/run/ToolQuestion.ts:189-260`), so executing the dependents there too is the natural continuation.

What decides the choice:
- how many such refusals there really are, from `tool-ordered` notes and same-batch refusals in review threads once claim order lands;
- a dependent call must survive a restart as part of the question, though it asks for nothing: the question record gains calls awaiting together with it, and the hosted road stages them the same way;
- what the operator sees: a question with non-asking calls standing behind it must show it.

Uncertainty: the benefit depends on a rate unknown until claim order works.
