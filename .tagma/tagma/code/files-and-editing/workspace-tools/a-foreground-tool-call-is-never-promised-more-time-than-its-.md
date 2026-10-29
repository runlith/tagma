---
id: 01a0d4d9-1769-777b-bcda-913997ac5624
title: A foreground tool call is never promised more time than its call envelope lets it run
ord: 131
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d4d9-3540-79dd-8dcf-71117bd0ca50",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0d4d0-154a-7613-b4e8-bc8c897819e0
sources:
  - kind: file
    ref: apps/tagma/server/src/protocol/commandRules.ts
  - kind: file
    ref: packages/agent-tools/src/bash
  - kind: file
    ref: packages/agent/src/agent/callProgress.ts
---
**Why.** Reflection [[897819e0]]: an agent ran a foreground `bash` with `timeout: 1600000` (26 min 40 s). Admission accepted the time, but the call envelope cancelled the call at 20 minutes. The command, 25ae384d, ended with exit 130, and the agent got no result. The envelope is `CALL_ENVELOPE_MS`, twice `LONGEST_ACT_MS`, in `packages/agent/src/agent/callProgress.ts`.

**What holds now.** Where no command rule applies, a caller's time is admitted as asked, on both roads: `resolveCommandTime` in `apps/tagma/server/src/protocol/commandRules.ts`, and `unruledTimes` in `packages/agent-tools/src/CommandWork.ts`. The envelope is fixed and armed at admission (`AgentCall.armEnvelope`). Only a hand-off to the background releases it.

**Target.** A foreground call is never promised more time than `LONGEST_ACT_MS` (10 min). That is the longest act the envelope is built to enclose; the envelope's second half is the room it has to take a silent call down.
- A foreground `bash` whose `timeout` is above the ceiling is refused before anything starts. The refusal names the ceiling and `background: true` as the way to run longer.
- The bash tool description names the ceiling, so an agent can plan around it before its first call.
- Background work, including `timeout: "none"` in the background, is unaffected.

**Scope.** Read each of these and hold the same ceiling across all of them:
- `bash` `timeout` on both roads: host admission and the local road;
- the `command.defaultMs` setting, where a machine or project sets it above the ceiling;
- every other tool whose input names a wait the caller sits through, such as `read_output` `wait` and the terminal waits;
- the call `limit` control, from the operator or the agent, on a foreground call. A limit past the envelope is a promise that will not be kept.

**Owner.** Fix this where the time is admitted, never with a second clock beside the envelope. If the envelope turns out to be the wrong figure instead, say so and do not raise it on your own.

**Acceptance.**
- A foreground `bash` with a `timeout` above the ceiling is refused with nothing started, and the refusal names the ceiling and the background.
- No door in the scope admits a foreground time that the envelope would cut first.
- The tests cover behaviour and data, never wording (rule f0530b87).
- The claims over the touched code are revised at their owners: [[c243dd9f]], [[0361efbb]] and any others found. The reflection [[897819e0]] is answered by the finished work.
- The typechecks of the touched packages pass, and the affected suites are green. Every command stays well under 10 minutes; the full server suite is not run.
