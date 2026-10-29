---
id: 01a12a0b-124b-7f2a-bdcd-23000195923b
title: Fix the review8 census and the execution host's late quotas
ord: 7
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a129c7-cc4e-72b1-bd45-ffce6245984a
  - kind: implements
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
sources:
  - kind: file
    ref: packages/execution-host/src/posix/macos/standing.ts
  - kind: symbol
    ref: packages/execution-host/src/posix/macos/evidence.ts
    symbol: command
---
Fix the confirmed review8 findings at the census, runtime quotas, and registration-publication owners; keep admission exact and pass the boundary checks.

Census excludes the actual PIDs of its own PS/lsof and empty lines. Parallelism stays; only the second spawn's EAGAIN with a live sibling gives one retry after the sibling's scope closes. The check with a controlled UID population and nproc=2 uses real spawned handles, one spare-process lease, and errno EAGAIN: both probes pass, census=1, exactly one execution admitted, the next gets host.executions. Red — ProfileInvalid at the last slot; green — 1/1, 6 assertions. The operator's global RLIMIT_NPROC was not changed.

The terminal finding was not confirmed. A real N=1 PTY at its own Rust holder gave scoped census 0→1; terminal ceiling 2 accepts exactly one extra reservation and refuses the third with host.terminals. Recount subtracts its live terminals for the host's common ceiling, and reserve compares liveTerminals+1 against it. The computation code did not change; 1/1, 6 assertions. The ttys fallback stays a conservative upper bound, not an exact inventory.

The subscription quota is read from the initialized profile; EvidenceScans are created after initialize, the native usage backend loads before census. The public-wire welcome test was red: subscriptions 10 against profile.readers 2; green — 1/1, 2 assertions. No new private/testing entries were added.

A late ProfileInvalid withdraws the matching registration through HostRegistration.withdraw. Red: a public read after the refusal returned Success; green — RegistrationMissing, 1/1, 3 assertions. Withdrawal removes no one else's identity and is idempotent: the whole HostRegistration.itest.ts 4/4, 17 assertions.

Full restart.stest.ts 7/7, 106 assertions, 11.20 s; descriptor accounting/fallback 2/2, 4 assertions. Full host and executions typechecks with the native compiler — exit 0; host consumers provide Processes under the new boot contract. Temporary diagnostics removed. The contracts are kept in [[57b676b4|probe accounting]] and [[3feb6fdb|late quotas and refusals]].

Delivery: 90f4594514f0a7b3cd9bf523171be990af855451; 86fd462541 already carries the host.ts edits. A direct path-limited git commit was used because of the recorded submit_work defect in [[56e7305b|commit-steps reading]]. HostRegistration.ts went in whole together with the parallel record extension onto the logic witness; the other foreign paths stayed out. After delivery read_changes shows 0 held paths.
