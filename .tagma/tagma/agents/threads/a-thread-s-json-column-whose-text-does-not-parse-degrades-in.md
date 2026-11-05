---
id: 01a1ad42-04ef-744c-89dc-278436fdc3f7
title: A thread's JSON column whose text does not parse degrades instead of failing the row query
ord: 165
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a15208-9958-790e-b6dd-4de6a15337e5
---
The safe readings of a thread's stored facts (`readableRowFact`, `readThreadFacts`, `readThreadTransport`, `readThreadBinding`, `readTransportCapabilities`, the thread record's birth) act on a value that parsed as JSON but has a shape this build does not read. A column whose text is not JSON at all fails earlier: drizzle's `text(..., { mode: 'json' })` decodes every selected row with an unconditional `JSON.parse`, so the whole query fails and the project list or the thread open fails with it. Tagma writes these columns only through JSON encoding inside SQLite transactions, so such text comes from outside corruption, not from an older build.

Fix at the column decoder: one JSON column type, declared once below threads and thread-record, whose read of unparsable text answers a value the safe readings refuse and degrade (and tell), used by the thread columns those readings cover (`native_thread` transport, capabilities, context reading, pending interaction; `thread_mandate.authority`; `thread.born_of`; run facts). Prove it with a door-level test that writes truncated JSON into each and opens the list and the thread. Found in review of the work that made damaged rows degrade; it waits on `platform/store`, which another agent's rollback holds.