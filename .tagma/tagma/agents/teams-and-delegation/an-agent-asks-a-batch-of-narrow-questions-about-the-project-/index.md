---
id: 01a1a889-4513-77cf-a806-c114296a801e
title: An agent asks a batch of narrow questions about the project and gets cheap, bounded answers back in the same call (`ask`)
ord: 15
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9277306eedae
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9292bfecd8d9
---
**Why.** A lead agent spends tens of thousands of its own tokens reading code to learn how one part of the project is arranged, and everything it read stays in its context, re-read at every later step at its own model's price. `spawn_agent` does not replace that reading: it delegates work — a named team member, a written brief, a report that opens a new turn of the parent — so the answer never comes back inside the step that needs it. `ask` hands a list of narrow questions to readers on a cheaper model, waits, and returns every answer with its evidence as the result of that one call.

**What a question is.** How a part is arranged, where something lives, what owns a place, what a contract or decision says — answered as a digest with evidence. Design ("how should X be built"), judgement ("is this a bug") and any change stay with the caller.

**Parts.** The children specify each:
- a built-in reader definition that answers one question with read tools, graph first, under a prompt of about a thousand characters;
- budgets any definition may set — prompt tokens, steps, seconds — and one gate that turns an exhausted budget into a last step without tools, whose text is the answer, with the price step of a model declared on its card;
- the `ask` call: one reader per question, born and collected the way workflow members are, every answer returned in the call's result, readers shown inside the call instead of the team.

**No second mechanism.** Readers are threads the spawn tree births with `collect` report delivery (`ThreadWorkflowMembers`, which the workflow engine already uses so reports never open the managing model's turn); the reader is an agent definition; the gate is an agent runtime rule. Nothing about one vendor lives in the core: which definition `ask` runs, its model and its budgets are definition fields and a setting, and the price step comes from the adapter's model card. Unconfigured, a reader runs on the caller provider's `lightTextModel`, or on the caller's own model where the provider declares none — so the call works for every provider, with or without a cheap model.

**Acceptance.**
- An agent asks three questions in one call and continues the same chain of steps with three answers; no report opens a turn of it.
- Every question comes back answered with the reader's text, its evidence and gaps in its own words, or failed with its diagnosis — never missing.
- No reader request exceeds the reader's prompt budget.
- The call is reachable from native threads and, through Tagma MCP, from foreign-CLI threads, with the same result.
