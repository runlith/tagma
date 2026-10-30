---
id: 01a18f32-a372-78a3-9235-3f5e7d64cdae
title: vendor-ids recovery does not unblock a lockfile-only landing
ord: 162
tags: ["reflection"]
fields:
  {
    "actual": "The recovery succeeded at e81318e42d in 1.0 s with no violation, but submit_work again refused inspection-failed: vendor-ids has no revision index; three gated programs exited 1.",
    "command": "submit_work({subject:\"build: record cost ledger workspace dependencies\",tasks:[\"c155fe6e\"],paths:[\"bun.lock\"],whole:[\"bun.lock\"]})",
    "expected": "After check_rules({inspection:\"vendor-ids\",over:\"all\"}) succeeds at the same HEAD, the prescribed revision index lets the gated programs judge the lockfile-only change."
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-30T23:02:50.633Z, from 65684db2.

The second refusal followed the exact recovery named by the first one, at the same HEAD. A previous whole-delivery commit succeeded after the same recovery; the remaining lockfile-only tree cannot be judged. No rule, hook or server lifecycle setting was changed.