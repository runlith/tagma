---
id: 01a118db-5778-76bc-8936-44382dfc8bb6
title: "A foreign model mid-turn on Claude over ACP: cutting the turn after the tool result, a new session from the folded journal, resuming the same session/prompt"
ord: 3
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a118cf-b972-77e1-a649-dbd8332f3ece
---
## Question

Can a turn be compacted mid-turn with a foreign model just as tracelessly as with its own, instead of deferring compaction to the turn's end?

## Possible road

The runner cuts the Claude Code turn right after the tool result: probe [[332f3ece]] showed the result survives while a pre-result cut repeats the call. Tagma retells the journal with the chosen model, the next session is assembled from the folded journal, and the Tagma turn continues in the same `session/prompt`. The new session has no interruption mark: Tagma assembles it from its own journal, not from the Claude Code transcript.

## Unknowns

- Claude Code starts a model request only with a new user message, so resuming needs an utterance that the native thread does not have.
- How smoothly the model resumes from the Tagma recap and a tail ending in a tool result.
- What a mid-turn runner process restart costs and what the operator sees meanwhile.

A live Claude probe with another provider's model as summarizer will decide.
