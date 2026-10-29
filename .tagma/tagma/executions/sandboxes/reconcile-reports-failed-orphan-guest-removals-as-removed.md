---
id: 01a0cad6-b08a-76be-b888-e440463cb1a8
title: Reconcile reports failed orphan-guest removals as removed
ord: 2
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/sandbox/guests/lease.ts
---
The reconcile's orphan sweep pushes every unclaimed guest into `removed` even when `runtime.remove` failed — the failure is swallowed by the catch beside it. The prepared-trees side reports what the backend kept as retained with its reason; the sandbox side reports a guest it never removed as removed. The next pass retries (nothing is lost), but the answer overstates what happened.

Done when a failed orphan removal is reported retained-with-reason like the prepared-trees side, instead of riding `removed`.