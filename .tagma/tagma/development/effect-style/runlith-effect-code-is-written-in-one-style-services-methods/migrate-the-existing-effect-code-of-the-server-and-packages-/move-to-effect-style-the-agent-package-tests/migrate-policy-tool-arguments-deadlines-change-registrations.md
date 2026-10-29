---
id: 01a13de0-5acf-7ec2-8e1c-0a00a58b216f
title: Migrate policy, tool arguments, deadlines, change registrations and call retention to Effect tests
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/src/agent/policy/AgentRuntimePolicy.test.ts
  - kind: file
    ref: packages/agent/src/agent/tool.test.ts
  - kind: file
    ref: packages/agent/src/thread/run/callRetention.test.ts
  - kind: file
    ref: packages/agent/src/thread/run/QuestionDeadlines.test.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadChanges.test.ts
---
Migrate the five test files to @runlith/effect-test: a managed Clock tells synchronous invoke from async wait with no busy loop, typed tool refusals and model dialect keep their data, TestClock verifies deadlines and scoped registrations, retention verifies release and scope isolation. Remove copy-pinning with an account of each replacement; proof is the group's green tests, typecheck, check_law and one review round.
