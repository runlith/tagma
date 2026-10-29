---
id: 01a150bf-6fc7-74e5-b8df-48414dc6d09e
title: "Child-agent model choice accounts for quota spend: measured model spend multiplier and live account balance instead of list price"
ord: 12
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bf681b67923
---
Most users work on subscription, not API, so the per-token price means almost nothing for model choice: what matters is how much work eats from its account's quota and how much is left there. Pools are separate — Sol spends OpenAI quota, Opus spends Anthropic — so "cheaper" depends on where the headroom is.

What can be done:
- a per-tier model spend multiplier — measured from Tagma run spend records (on the same work, Opus xhigh spends several times more tokens than Sol xhigh); for a subscription this is a quota multiplier, for an API key it is money;
- live account state for the child-agent list row (`ok` / `tight` / `out`) from the quota readings Tagma already takes;
- calibration: a task's share of the quota window — measured from reading changes, refined from user records.

Unknown: how much quota a token costs at vendors (not published, windows differ), so everything is measurement and heuristics, not calculation.
