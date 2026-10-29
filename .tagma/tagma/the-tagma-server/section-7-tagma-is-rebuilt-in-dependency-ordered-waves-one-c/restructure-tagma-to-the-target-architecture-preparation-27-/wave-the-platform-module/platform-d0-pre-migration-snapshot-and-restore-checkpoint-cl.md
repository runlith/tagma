---
id: 01a0e821-e94a-789b-aa92-ce05b5977128
title: "platform D0: pre-migration snapshot and restore — checkpoint, clone, rollout manifest, `tagma db restore-snapshot`"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e822-2ddd-7f8e-b25b-5c6f6541bc02",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
---
Section 2 [[70083b67]] §2.10 (question 11) makes rollback of every stored-data migration the pre-migration snapshot: before a pending migration batch, a WAL checkpoint and a clone or copy of the store, a manifest of the rollout cuts (each rollout's generation, length and last-record hash), and a restore command with its restore intent that cuts rollouts back and renames the snapshot over the store; the export lane keeps `.gen-<n>` files while a snapshot stands. Part of platform's D0 (W0 carries "snapshots"). D4 ([[ae74039e]]) is the first migration it guards and waits on it. D0 pins the manifest-selected generation at snapshot capture, with clone-or-copy preservation and snapshot-owned cleanup at replacement and boot. Restore reads only that immutable pin. D0 advances the generation in full exports, repair and harness compression/wake, preserving projection offsets for byte-preserving transforms; legacy read-only decompression never writes the cursor. D3's common lane completes transform counting and per-replacement generation retention.

Implementation landed in `49ceb615f2`, `f9740b96d0` and final correction `7c191de54b`, under the accepted refinements of [[90679df2]]. The lifecycle is `platform/store/snapshot.ts`; providers retain readable source credentials until durable evacuation succeeds, and restore preflight precedes its intent and external publications. The final diff and migration metadata were checked. Both inspections judged 34 paths with zero new violations or unjudged paths. Filtered typecheck produced no D0-path diagnostic, but the server check failed elsewhere. The composition unit file previously passed 4 tests and 17 assertions; its final run failed before the tests with `SyntaxError: Export named 'InputOutcome' not found in module 'packages/executions/src/protocol/input.ts'`. Integration and system tests were not run, as required by the wave brief. Independent Opus and Astra reviews found no remaining critical D0 finding in their final bounded passes (133 s and 89 s); the later providers runtime regression and logical-account collision were corrected at the credential owner, whose four pure unit cases passed.

Completion is recorded with `specOk: false`. Merge-time work remains: run the authored snapshot, CLI and recovery integration coverage and full branch checks; reconcile source moves, known-false legacy claims and stale baselines without re-stamping them as D0 evidence; finish D3's lane counting and per-replacement retention in [[29ce4645]]; carry mirror sidecars through graph D1 rather than D0's release policy. The aimed doctor pass left baseline gaps and made no correctness attestation. Disclosed limitations remain: private-copy VACUUM needs space on SQLite's separate temporary volume; compressed rollout cuts require a full stream scan; non-CoW restoration can refuse for capacity after intent publication and requires a resumed restore; row-loss counts are best-effort and do not compare field values; an appended migration chain after an interrupted batch requires finishing or restoring the earlier batch; quarantine retention and some rollout staging cleanup await their later owner work.
