---
id: 01a1a2c5-58f6-7a6f-8a84-858fbd498fc6
title: Execution host boot refuses when /bin/ps does not answer within a fixed 2 s on a loaded machine
ord: 70
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a2c5-9a6d-704e-9c26-f2c1698048d6",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a1a297-fcf1-7cba-990f-81898883474c
sources:
  - kind: file
    ref: packages/execution-host/src/posix/macos/standing.ts
---
On 2026-11-03 a test world's execution host refused to boot with `BootRefused: the processes of user 501: /bin/ps did not answer inside 2000 ms`, and then looped `WireUnavailable`. The machine was loaded by dozens of agents. The standing census bounds `ps`/`lsof` by `MACHINE_PROBE_LIMITS.probeMs` (2 000 ms, `standing.ts`), and a timeout there refuses the boot. On a slow or busy machine that turns a live, answering process into a refusal on deadline expiry, against the rule that a wait delivers a verdict on fact. Find where the census decides boot, make the verdict depend on the probe's exit or failure rather than a fixed clock, and keep the output caps. Prove it with a probe that answers after the old deadline. Execution `b69caabe-4e6e-462c-850d-101f3992f759` holds the failing run's output.