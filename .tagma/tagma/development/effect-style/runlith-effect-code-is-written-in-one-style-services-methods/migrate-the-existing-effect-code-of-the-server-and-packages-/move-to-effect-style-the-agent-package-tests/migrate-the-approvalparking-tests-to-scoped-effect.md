---
id: 01a13fef-0bdb-7d2f-a76c-772c9cefd057
title: Migrate the ApprovalParking tests to scoped Effect
ord: 20
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d30-d804-7b33-9b8b-12527b27377d
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ApprovalParking.test.ts
---
Migrate ApprovalParking.test.ts to @runlith/effect-test with no ManagedRuntime, cast ledger or setTimeout flush. Use a full ledger over the existing runStore; the release watcher synchronizes reconciliation, TestClock verifies deadline removal. Keep single take, question replacement, run-ownership loss and deadlines/watchers release. Change neither production nor the storage port. Checks: one file with --parallel=1, bun check -p packages/agent, law and one Sol+Muse round; evidence and diff to the parent before the commit.
