---
id: 01a0de31-d718-7d80-913d-4fbf1a17822c
title: A raw profile read by a thread is handed over as a `.cpuprofile` file in its scratch, never inline
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0de28-0af5-735b-a8eb-bade04dc0b11",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0d857-51a5-7749-87bc-bb0ed98ba5db
sources:
  - kind: file
    ref: apps/tagma/server/src/projection/performance.ts
  - kind: symbol
    ref: apps/tagma/server/src/performance/operations.ts
    symbol: PERFORMANCE_PAIRS
---
Reflection d98ba5db: `read_performance {type: profile, raw: true}` answers the inspector artifact pretty-printed inside the tool answer — 20–56 KB per profile in thread 01a0d842, whole when under the 50 KiB ceiling and a useless JSON preview above it — and the agent then had to move the bytes to a file to analyse them.

**Do:** for a caller that is a thread with a file scope, `read_performance` and `read_host_performance` write the raw artifact into the caller's scratch as `<profile id>.cpuprofile` and answer its path and size beside the report, which no longer carries the artifact. Callers without a scratch (the operator's HTTP door, a foreign CLI) keep the artifact in the value.

**Done when:** a thread's raw read answers a file path and the file holds the artifact; the claims over the read bodies and the profile text are written.