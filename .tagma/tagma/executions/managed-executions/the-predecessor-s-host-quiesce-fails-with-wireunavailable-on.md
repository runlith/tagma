---
id: 01a19298-4fea-7c37-86bf-402558e1b230
title: The predecessor's host quiesce fails with WireUnavailable on every update, so the successor swaps the host logic under its own live connections
ord: 103
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19298-e97f-7459-9b3f-b3533e7b9b36",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
---
`departure.ts` `yieldPlace` logged "the execution host could not be quiesced for its successor: WireUnavailable; its logic stays" on every update with a changed host bundle since 2026-10-29 (serve.log: 10-29 20:06, 10-30 13:29, 10-31 11:50, 10-31 16:22 local). On 10-31 the successor (pid 66222) was ready at 15:23:11Z and the host logic was replaced at 15:23:25Z (new `host.sock`, logic pid 69501), cutting the successor's live connections and subscriptions; no "execution host taken" phase stands in restart.json. Spec d86d6647 swaps the logic in the gap before the successor connects. Find why quiesce cannot reach the host at departure (the reason string is lost because `WireUnavailable` carries no message) and fix it at its owner.