---
id: 01a0caad-20e5-7aab-a5c7-8a1d8a26ca13
title: "`GET /api/journal` with no limit reads the whole journal"
ord: 150
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/journal/eventLog.ts
  - kind: file
    ref: apps/tagma/server/src/http/retired.ts
---
`GET /api/journal` with no `limit` reads the project's whole journal: the endpoint declares `limit` optional, the handler passes `undefined` through, and `Journal.events` applies no default — `filter.limit !== undefined ? base.limit(...) : base` (Journal.ts:187,196; handler journal.ts:34,43; `limit` optional at api/journal.ts:10). Rule [[68659e3b]] requires a derived default and ceiling with the total beside the page. The events road already takes the agent page; this road is the one journal read with no default.

Done when the page road takes a limit with a derived default and ceiling, or the code states why this read is the exception.