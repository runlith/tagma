---
id: 01a13604-e205-7fbc-a922-60aa00ccad69
title: Typed ACP session-start refusal (unknown-account) loops every 15 s as uncertain while the run hangs in Working with no feed error
ord: 14
tags: ["reflection"]
fields:
  {
    "actual": "Run 01a135fd-a7ef stays running with a live heartbeat for over 6 minutes. The runner process never started. serve.log gets a WARN every 15 s: \"a protocol session is uncertain … unknown-account: claude-code has no signed-in directory account default\". The feed shows only \"Working · run 5m\", read_thread shows \"process: uncertain\", and stalled is never set.",
    "command": "continue_agent acp-claude after set_agent_model to claude-code/claude-opus-5-5, when the claude-code account in harness-accounts.json has signed: false",
    "expected": "The run ends as failed with the unknown-account refusal and a \"sign in or select an account\" message in the feed and in the parent report, like native NotInstalled"
  }
---
Filed from project `runlith`.

`HarnessAccounts.launch` (`providers/accounts/harnessAccounts.ts:285`) returns `GateRefusal('unknown-account')`. `ProtocolAttendance.attend` (`external-harnesses/protocol/attendance.ts:213-224`) catches it via `catchCause` and turns it into `uncertain`, then `observe` raises attend again, round and round. A refusal that will not clear on its own must end the run through the core, not mark the resource as uncertain. Thread 01a135fb-2d24-73fc-a435-5349421c30c5.
