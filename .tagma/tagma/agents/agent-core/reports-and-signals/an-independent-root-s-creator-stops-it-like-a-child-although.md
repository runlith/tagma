---
id: 01a16996-6b9a-7a1d-ba14-f89f07904a3e
title: An independent root's creator stops it like a child, although the root never stands in their lineage
ord: 9
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9277306eedae
---
**Question.** Should whoever gave birth to a thread gain control over it (stop, continue) without becoming its parent in the lineage?

**Motivation.** The secretary starts a team lead via `spawn_agent` with `link: "root"`, because the lead runs its own team outside the creator's tree. The operator asks the secretary to stop that lead. `stop_agent` refuses: the tool stops only the caller's child. `interrupt_agent` stays, which interrupts the turn and gives the same result, but that is a workaround. The operator expects the creator to stop what it created "normally".

**What stands.** Feature [[306eedae]] records that stopping, continuing, model switching, archiving, and rolling back a born root need the operator's consent, as for any non-descendant. The root's birth already records who gave birth to it and with which run.

**What the choice decides.**
- Separate "who created" from "whose child in the lineage". The creator gains a separate relation to the root, and that relation grants control without the parent's depth, team, or budget.
- Define how such control differs from a parent's rights, and whether the operator's consent is needed. When the stop order itself came from the operator, the question is moot.
- Reduce `stop_agent` and `interrupt_agent` to one understandable act for any thread the caller may control.

**Uncertainty.** It is unclear whether this breaks the meaning of a root — "outside the creator's tree, no relation after the answer". Perhaps the creator relation should live only while the root owes it an answer.
