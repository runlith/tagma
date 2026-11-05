---
id: 01a1a889-59c9-7db6-bbee-b8fb1baf46ae
title: A definition bounds its run by prompt tokens, steps and seconds, and an exhausted budget forces the answer instead of cutting the run
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14be4-2437-75af-92bd-b429e21dd347
---
**Pricing fact this rests on** (Anthropic pricing page, read 2026-11-04). Claude Haiku 5.5 bills a request whose prompt exceeds 100,000 tokens at five times every rate of that request — input, cache and output. The prompt counts input, cache reads and cache writes; output does not; each request is priced alone, earlier ones keep their price. Claude 4.6 and later keep prior thinking blocks in context and bill them as input, so a run's prompt grows by its own outputs as well as by what it reads.

**Model card.** `ModelCapacity` gains the prompt length above which a request pays higher prices (suggested name `premiumAbove`); the Anthropic adapter declares 100_000 on `claude-haiku-5-5`. The core reads the field and knows no vendor.

**Definition field `budget: { prompt?, steps?, seconds? }`.** Any definition may set it; a thread born from it is bounded by it. A prompt budget left unset takes the card's `premiumAbove` where declared. Defaults of the built-in `reader`: steps 25; seconds 180, and never more than the caller provider's promised cache lifetime minus a margin — the caller waits inside its step, and a wait past its cache lifetime makes its next request re-write its whole context at full price (Opus 5.5 at 150k: about $0.75 instead of $0.03).

**The gate.** One agent runtime rule, contributed by native-harness like the other turn rules, reads the run's last context reading (`ThreadContextAnchor`), the estimate of what joins the next request (`estimateThreadTokens`), the steps taken (`AgentRunState`) and the run's clock:
- at 70% of any budget, one `guide`: what is used, and to answer with what it has unless one more read decides the question;
- `beforeTool`: when the step's results would carry the next request past the prompt budget, or the steps or seconds are spent, every call of the step is denied with one short line, so the pending calls get results without content;
- `beforeStep` after that: `restrict` to `answer` and `require` it where the run's catalog holds `answer`; otherwise `restrict` to no tool, so the final step is text alone and that text is the run's answer;
- `beforeClose`: a text-only finish without `answer`, in a run holding it, is required once to call `answer`; a second text-only finish is taken as the answer, marked partial.

A budget binds any thread whose definition sets one, a child born by `spawn_agent` included, whose final text then reaches its parent as the fallback report does today.

The forced request's prompt is the current context, the last output and the short denials: under the budget by construction. Changing `tool_choice` invalidates only the messages cache (Anthropic prompt caching), so the forced request re-writes that part as a cache write — on Haiku 5.5 at 99k about $0.012.

**Forced tool use follows the card.** `agentStepToolPolicy` turns `require` of a named tool into a forced `tool_choice` without consulting the card's modes; it consults them only for `request`. Opus 5.5, Sonnet 5.5 and Fable 5.1 reject forced tool use with a 400. `require` of a tool the card cannot force becomes that tool alone with `auto`, in `agentStepToolPolicy`, so the gate works on every model. No rule uses `require` with a tool today, so nothing else changes.

**Acceptance.**
- With a scripted model whose tool results grow the context, a thread with a prompt budget never sends a request whose prompt exceeds it, and ends with an `answer` marked partial.
- Spent steps and spent seconds end the same way.
- On a card without the `tool` mode the forced step sends `answer` alone with `auto` and no forced `tool_choice`.
- A definition's `budget.prompt` overrides the card's `premiumAbove`; with neither, the prompt is unbounded by this gate.
