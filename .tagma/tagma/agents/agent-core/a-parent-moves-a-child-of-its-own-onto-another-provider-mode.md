---
id: 01a0cbde-d137-7e8c-9fe6-81e667eca2b2
title: A parent moves a child of its own onto another provider, model or rung — only when the child's provider will fail the same call again, or on the operator's word
ord: 178
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: packages/agent/src/collaboration/CollaborationTools.ts
    symbol: collaborationTools
  - kind: symbol
    ref: packages/agent/src/collaboration/CollaborationVoice.ts
    symbol: spawnModelPolicy
  - kind: symbol
    ref: packages/agent/src/collaboration/ThreadEnvelopes.ts
    symbol: completionReport
  - kind: symbol
    ref: packages/agent/src/collaboration/ThreadSpawnTree.ts
    symbol: continueChild
---
A parent can move a child of its own onto another provider, model or reasoning rung after birth. Today the model is judged once, at spawn ([[00c9c99e]]), and only the operator's own door (`setModelSettings`) moves it later; a child whose provider ran out of quota is therefore stuck, because quota exhaustion is never retried ([[372be821]]) and the parent can only continue it onto the same failing call.

## When a parent moves a child

Exactly two occasions, and the prompt says so:

- the child's failure says the same call will fail again on that provider — quota or allowance exhausted, the provider unreachable or refusing, a failure marked not retryable;
- the operator asked for the change in this conversation.

Never for diversity, never as a guess at a better fit. Operator-only models and rungs keep their rule: named only on the operator's word, lowered when merely carried over.

## The verb

`set_agent_model(threadId, provider?, model?, reasoning?)` — a verb of its own beside `continue_agent`, because the move serves two follow-ups: a failed or stopped child is then taken up with `continue_agent` over its own history, and an idle child that finished is given its next `send_task` on the new model. Extending `continue_agent` alone would leave the second case out, since `continue_agent` refuses a child whose last turn completed.

- Only the child's parent moves it, the same edge as continue ([[90b333a0]]); anyone else is refused naming that.
- A child whose turn is going is refused: stop it first. Moving the model under a running turn would change what the next step of someone else's turn is made of.
- At least one of the three is named; naming none refuses.
- What is not named is kept from the child: the provider stays; the model stays when the provider stays and becomes the new provider's default when it moves; the rung is carried over and judged against the new row's ladder.
- The selection is judged exactly as spawn judges an explicit one — unknown provider or model refused in the catalog's words, a named rung the row does not offer refused, a carried operator-only rung lowered and reported.
- Moving to another provider returns the child's account to that provider's own rule; staying keeps it. Stored switches the new row does not declare are dropped.
- A collaborator the product executes itself (a foreign CLI harness) is refused: its model is pinned at birth by the product, and the tree has no road to move it.
- The answer names what the child now runs on and what was lowered. The move is written where the operator's own move is — the thread row, its published snapshot and its rollout record — so the child's thread shows it.

## What the parent sees

- `list_agents` prints each native agent's provider, model and rung, so the parent knows what it would be moving.
- A failure report that names a quota or provider failure names `set_agent_model` then `continue_agent` as the way on, instead of only forbidding a replacement.

## Acceptance

- A parent moves its failed child to another provider and continues it; the continued run calls the new provider over the child's history.
- A parent moves an idle, completed child; its next `send_task` runs on the new model.
- A non-parent, a running child, a harness child, an empty selection, an unknown model and an unoffered rung each refuse with their reason.
- The collaboration prompt states the two occasions and no longer forbids a cross-provider move after a failed run outright.
