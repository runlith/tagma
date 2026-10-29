---
id: 01a0de1b-6e84-75e9-ba79-840363ae98b8
title: Keep the last measured account allowance across server restarts
ord: 18
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0de1b-a2ab-7b2e-9fdf-213aa26e3f8e",
    "status": "done"
  }
---
Persist the last successful quota observation per stored provider account at the account-quota owner, restore it before the boot refresh, and present it as last known until a fresh observation arrives. Preserve the observed time and show refresh failures without erasing the figures; removal, replacement and unreadable account stores must not attach a snapshot to the wrong account. Start at `apps/tagma/server/src/ai/AccountQuota.ts`, its storage composition in `http/runtime.ts`, and the account usage projection. Prove with a restart over the same durable store, a failed boot read, and account removal/rotation; run affected checks and reconcile the source-bound claims.