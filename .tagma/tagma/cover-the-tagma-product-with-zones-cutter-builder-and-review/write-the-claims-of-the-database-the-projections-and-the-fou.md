---
id: 01a0ca97-13f4-7e9f-bc7a-210182167fbe
title: Write the claims of the database, the projections, and the four small hosts a session reaches
ord: 217
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0cad0-2fd4-7f42-a434-653095abe278",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca94-63c5-789a-9e91-c36105042d40
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: apps/tagma/server/src/ai
  - kind: dir
    ref: apps/tagma/server/src/db
  - kind: dir
    ref: apps/tagma/server/src/projection
---
Read `db/`, `projection/`, `ai/`, `mcp/`, `power/` and `artifacts/` whole. Together they are under ten thousand lines, and they are grouped into one task because each is small and none is adjacent to another — write them as the six areas they are, not as one subject.

Write the claims of [[9217020c]], [[70b217f6]], [[80570fd0]], [[177015e0]], [[138cbf2b]] and [[d4be6dfe]]: what the single write permit costs a caller and what a unit guarantees inside it, what a projection withholds and how it says so, what an account's allowance is read from and how stale that reading may be, what an MCP server's status is a reading of, when a sleep assertion is taken and released, and what an artifact's address outlives. The rule [[a00f91b0]] binds here — anything that names a cadence must have a driver.

Done when every claim is written from the code and verified after a reading of all its sources, every symbol anchor resolves, `run_doctor` over these paths stands clean, and a review leaves no FALSE, OVERBROAD or UNSUPPORTED unresolved. Precision to match: [[d1caad35]] and [[249ce587]].