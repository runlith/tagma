---
id: 01a15bd4-6bd5-7099-a535-5c59728cd1be
title: Limit window merged into an account quota from another call's answer stays next to the run's windows and survives their observations
ord: 13
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a15b94-3ab3-7f8e-9055-3049d8ecdc6e
sources:
  - kind: symbol
    ref: apps/tagma/server/src/providers/quota/ledger.ts
    symbol: accountQuotaLayer
---
`observe` and usage reads replace an account's quota wholesale: a run answer and `wham/usage` report every window they know. Neither reports the ChatGPT image limit — it arrives only in the image call's answer. So `merge` places such a window into the quota under its "kind and label" key and remembers it in the account row (`merged`), and each following quota replacement appends the remembered windows missing from the new observation. Without it, the first run observation would wipe the image window, and the operator would see it for seconds.

Remembered windows are stored next to the account's saved reading (the `merged` column in `account_quota_reading`) and return with it in the row at startup, so they survive a server restart. They reset together with the reading when the account signs in again. Until the image is drawn, the window stays last-measured, with its reset time. Once the reset passes, the next quota replacement writes the window reset: 0% with the next reset after the window length when known, or with no reset when not. Otherwise a window with a passed reset would keep the whole account reading stale forever: the UI treats a reading as stale when any of its windows' resets already passed.
