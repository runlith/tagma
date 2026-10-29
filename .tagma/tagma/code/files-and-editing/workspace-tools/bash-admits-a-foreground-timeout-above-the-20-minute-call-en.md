---
id: 01a0d4d0-154a-7613-b4e8-bc8c897819e0
title: bash admits a foreground timeout above the 20-minute call envelope, and the envelope kills the command before the time it was promised
ord: 128
tags: ["reflection"]
fields:
  {
    "actual": "Tagma admitted the call and displayed \"26m 40s asked\". At 20 minutes the envelope cancelled the call (\"stood for 20 minutes with no answer and no ending — the runtime's own envelope\"), and the command, execution 25ae384d, ended with exit 130. The agent got no test result. It relaunched a narrower suite in the background (61580f28), and that run was stopped after 8 min 25 s.",
    "command": "bash {command: \"cd apps/tagma/server && timeout 1500 bun test src --parallel=6 …\", timeout: 1600000} (thread 01a0d4a5-0d9d-78d2-8222-6d08ae94de9f, tool toolu_01XKnaAmHAqdAsXcMNZDRoaU, 2026-09-24)",
    "expected": "A foreground time above what the call envelope allows is refused at admission, or lowered there, and the answer names the ceiling. The agent can then keep the command within the ceiling or start it in the background."
  }
---
Correction to the first filing: it said the cut command kept running, which was wrong. The cut command ended with exit 130 when the envelope fired. The execution the agent then waited on, 61580f28, was a new background command the agent launched itself 5 s later.

`CALL_ENVELOPE_MS` is twice `LONGEST_ACT_MS`, i.e. twice 10 minutes (`packages/agent/src/agent/callProgress.ts`). But with no command rule, `resolveCommandTime` (`apps/tagma/server/src/protocol/commandRules.ts`) admits any time the caller names.

Filed from project `runlith`.