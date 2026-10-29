---
id: 01a1645e-1279-7d15-aadb-4a61f848dfa7
title: Cursor quota is accepted only after matching the CLI identity against the key account
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/adapter-cursor/src/quota.ts
---
Cursor quota is accepted only after the CLI identity is matched against the key account. The SDK key and the cursor-agent token may belong to different people. So the adapter reads the CLI identity through DashboardService/GetMe and only after the emails match accepts GetCurrentPeriodUsage. The token stays with the CLI and is not stored in Tagma; no login, a different identity, and no windows are a temporary outcome with a reason, which the shared ledger re-reads while keeping the previous reading.
