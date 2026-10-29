---
id: 01a14c08-22b6-75de-88f8-5bf539bbe00b
title: Each account's quota is read from the provider, arrives with model answers, and survives the server restart
ord: 8
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9285e59adbe3
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92913ae88b52
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bf681b67923
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/models/quota.ts
  - kind: file
    ref: apps/tagma/server/src/providers/quota/ledger.ts
  - kind: file
    ref: apps/tagma/server/src/providers/quota/readings.ts
  - kind: file
    ref: apps/tagma/server/src/providers/quota/refresh.ts
  - kind: file
    ref: packages/adapter-cursor/src/quota.ts
---
**Value.** The operator sees how much is left in subscription or key windows before the vendor refuses; compaction and keep-warm use the same reading to decide whose quota to spend ([[e59adbe3]], [[3ae88b52]]).

**How.** The `list_accounts` and `refresh_accounts` operations and the live account feed; [[81b67923]] and the Providers screen show them.

**Behaviour.** The provider supplies quota windows (session, week, month, per model) either through a separate read or in model-response headers; polling does not repeat a fresh reading from a response. The poll runs at server startup and then periodically while the window watches the accounts, and also right after the nearest reset of a window for an account watched by the app window. So after a reset the reading does not keep the previous numbers until the next tick, and a fresh model answer received before the reset does not cancel such a reading; a vendor refusal by rate limit postpones the poll for the term it named. Claude Code quota comes only from running SDK sessions — no background `claude` runs for it. In CLI-login mode the Codex line quota reads Tagma's own path on the same login. The reading survives the server restart and is marked as previous until a new one arrives; a new login of the same account drops the old reading. A read failure leaves the last reading with a reason. Cursor reads quota over the local cursor-agent login only when the account matches the chosen key; no login and another account give a temporarily unknown quota, which the next tick reads again.

**Limits.** There is no quota for speech keys, OpenAI-compatible servers, and CLI threads except Claude Code. Windows and their terms are set by the vendor.
