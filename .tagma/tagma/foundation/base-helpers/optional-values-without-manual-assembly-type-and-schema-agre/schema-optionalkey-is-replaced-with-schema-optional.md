---
id: 01a127f0-b2c2-7874-a236-cb257814300f
title: Schema.optionalKey is replaced with Schema.optional
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a127f0-4ce7-7edb-adb0-9eb640ffd688
  - kind: waits-on
    to: 01a127f0-b368-7fbf-ae46-f6f97d07185e
---
Of the original 655 calls in 98 files, 571 become `Schema.optional` in 91 files. 84 stay exact: 62 admit `null` in the inner schema, 22 belong to patch structures or key-presence checks. `presenceChangeSchema` keeps the exact mapping of seven patch fields; the dynamic `TerminalColorOverrides` fields and their type also stay `optionalKey`.

In replaced fields, decode accepts a present `undefined`, and encode keeps such a key until JSON.stringify. Effect's JSON codec turns it into `null`, so nullable fields and 'don't change' patches keep their original exact declaration; their object is assembled by the owner. A test through the live RPC codec proves: a missing cursor is kept, an explicit `null` clears it, `undefined` fails before sending. `Unknown` itself accepts `undefined`: such fields keep the previous contract, with no extra ban.

Done when the remaining `optionalKey` match these two reasons and checks confirm the change. Delivery: `e6ef21f468`; 120 executions unit/wire/integration tests, 953 server unit tests, 21 checks/law tests, and narrow exact-field checks are green; previous test expectations were unchanged. Full typecheck of agent/agent-tools/execution-host is blocked by untouched agent fixtures (`abortSignal`, `projectId`); full server typecheck does not fit the one-minute limit; runtime/schema and changed tests are verified narrowly. Remaining are an independent `ThreadAggregate` failure on `tx.afterCommit` and an LLM animated-image test timeout.
