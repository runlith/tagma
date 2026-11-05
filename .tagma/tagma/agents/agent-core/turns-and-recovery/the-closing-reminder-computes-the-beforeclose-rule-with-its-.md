---
id: 01a15261-6006-77e2-a77c-4cab8c2be8d3
title: The closing reminder computes the beforeClose rule with its own run's state
ord: 10
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentRunner.ts
  - kind: file
    ref: packages/agent/src/agent/AgentRunState.ts
  - kind: file
    ref: packages/agent/src/agent/AgentTurn.ts
  - kind: file
    ref: packages/agent/src/collaboration/ThreadObligations.ts
---
The native loop computes `beforeClose` on a clean text-only finish, unless a stop condition (`stopWhen`) already ends the run: otherwise a rule guiding at every close would keep the run past its step limit. Guidance defers completion to the next step, and the "reminded" mark is held by `AgentRunState`, so a repeated end or a changed model context spawns no new reminders. On recovery, closing marks and successful mutations of the same run count; collaboration decides who else is still owed a final answer. A noncritical failure becomes a typed `rule-failed` note. A hosted run has no model loop of its own: hosting evaluates the same hook when the vendor is about to end its turn cleanly (`ThreadHosting.close`, reached through `close_hosted_turn`), through the run's own door and `AgentRunState`, so each rule reminds once per run on both roads. Its one step carries the tool results the run's transcript holds, since a hosted run folds no native steps.
