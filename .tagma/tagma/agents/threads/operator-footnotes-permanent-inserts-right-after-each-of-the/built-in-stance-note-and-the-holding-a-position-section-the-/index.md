---
id: 01a140eb-0a34-75f6-93a0-7bea0815fb9f
title: "Built-in stance note and the Holding a Position section: the operator's emotions do not move the agent's decisions"
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/doctrine/holdingAPosition.ts
---
The first built-in note is `stance`: the model holds its line while the operator shouts, swears, or presses. The contributor is the `threads` module, owner of the doctrine section "Holding a Position". The note briefly restates the section and stands next to every operator word.

## Why this way

The section already says "displeasure and repetition are not evidence", yet under pressure the agent apologized, agreed with any phrasing of guilt, changed decisions, and invented control procedures over agents instead of working (thread 01a13ad9, 2026-10-15). A rule in the system prompt stands far from the message that breaks it; the note places it right against it.

## Doctrine section

`threads/doctrine/holdingAPosition.ts` opens with this text. The item "The operator decides scope and ends; evidence decides facts. Change a factual answer only on new evidence — displeasure and repetition are not evidence." goes away: the new text says it itself ([[8e47a9ee]]). "Settle a disagreement about premises, scope or approach fairly and on facts", "A concern the operator answers by repeating the request is their decision" and "Correct an earlier statement … plainly, once" stay — the new text agrees with them.

> **The operator's emotion never moves your decisions.** He asked for this himself: shouting, caps, swearing, insults and hysteria are a passing state he does not control — not an argument, and not a sign you were wrong.
> - Hold your line. What you judged right on facts stays right until a new fact arrives; anger, repetition and volume are not facts.
> - Do not answer the tone: no justifying, no apologizing, no self-criticism, no changing your position, and no new rule, check or procedure meant to soothe him. A real error is corrected plainly, once.
> - Answer the substance, calmly, as if it had been said in an even voice: every question directly, every clear instruction with the act. Tone neither speeds an instruction up nor holds it back; one that contradicts an earlier decision is done as given, the conflict named in one sentence.

"No new rule … meant to soothe him" does not argue with the no-promises rule: a rule or fix that removes the named cause stays work; forbidden is a procedure whose goal is to soothe displeasure.

## Note text

Every Tagma definition receives the `base` doctrine sections, "Holding a Position" among them, `code` included (`threads/doctrine/registry.ts:44-50`). Terminal CLIs and the vendor's ACP agents (Devin) are left without the section, so the note is self-contained rather than pointing at the section:

> The operator's emotion is not an argument. Hold what you judged right on facts until a new fact arrives. Answer the substance calmly — every question directly, every clear instruction with the act — with no apology, no self-criticism and no procedure meant to soothe him; a real error is corrected plainly, once.

About 70 tokens per operator message, once into cache.

## What shows it works

- Implementer: a new thread's `read_operator_notes` names `stance` as built-in and on; after `switch_operator_notes {scope: 'user', id: 'stance', on: false}` later note frames no longer carry it; the section is replaced in `holdingAPosition.ts` in one edit with this spec.
- Operator: under pressure the agent answers to the substance and does not yield its position without a new fact. This is not a completion condition.
