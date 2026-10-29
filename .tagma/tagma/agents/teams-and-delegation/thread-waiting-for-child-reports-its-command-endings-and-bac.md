---
id: 01a14bae-6720-7d62-897a-92913ae88b52
title: "Thread waiting for child reports, its command endings, and background calls stays warm: keep-warm pings until the prompt cache expires"
ord: 12
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: supersedes
    to: 01a14b6d-b261-7776-88b3-4f88d974a6b6
sources:
  - kind: dir
    ref: apps/tagma/server/src/native-harness/keepWarm
  - kind: file
    ref: packages/agent/src/thread/run/keepWarmRun.ts
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/contract/wire/settings.ts
    symbol: keepWarm
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/contract/wire/settings.ts
    symbol: keepWarmPings
  - kind: symbol
    ref: packages/agent/src/collaboration/reporting.ts
    symbol: reportOwed
---
**Value.** An agent waiting for child reports or the endings of its own commands and background calls does not pay for rewriting the whole context: the server briefly wakes it before the prompt cache expires, and the report or ending finds it warm.

**How.** The `agent.keepWarm` and `agent.keepWarmPings` settings.

**Behaviour.** Waiting is an idling thread with a working descendant, or one owed the ending of a running command or background call, its own or its descendant's. A ping is a short visible turn on the thread's model and account, which the agent answers with one word. The ping count for one wait outlives a server restart; the wait ends with any run for another reason.

**Limits.** A ping needs a warm context read with a promised cache lifetime and available quota for the thread's model; where no lifetime is promised, there are no pings. A ping is not reported to the parent and does not enter search.
