---
id: 01a1354b-d25f-781a-bf7b-29c639e8b6e1
title: "The agent slept through its reviewers' reports: `sleep 280; echo waited` bypasses the foreground sleep refusal, and child reports do not interrupt the wait"
ord: 17
tags: ["reflection"]
fields:
  {
    "actual": "The command slept 280 s (12:35:59–12:40:40). The review-opus (12:37:20) and review-races (12:37:54) reports lay queued behind the sleep ~3 minutes. Earlier the same thread slept `sleep 240; echo waited` (12:28–12:32). Total ~8.5 min of pure sleep at 717k context.",
    "command": "bash {command: \"sleep 280; echo waited\", description: \"Wait for remaining reviewers\", waitMs: 300000} in thread 01a13517-7ef9-76be-94a3dc31a7f1, while its reviewers work",
    "expected": "A line that only sleeps refused before launch (spec 356d0443), the agent ends the turn, and a child's report opens the next turn at once; or an arriving report cuts the wait"
  }
---
Filed from project `runlith`.

Two holes:
- `shellOnlySleeps` (packages/agent-tools/src/shellShapes.ts) refuses only if every simple command is `sleep`; the trailing `echo waited` walks the line past the refusal.
- Only `isReaderWords` interrupts waiting (`heard` in packages/agent/src/agent/AgentRunner.ts): only the operator's words yield way. Child reports excluded deliberately (spec 356d0443 §6: "Agent envelopes are a separate question").
The agent's thought before sleep (record 2022): "I'll wait for the remaining two reviews to come back before committing fixes". The prompt carries "MUST NOT stall a turn because a child is running … END the turn", but at 717k context the agent did not follow it.
