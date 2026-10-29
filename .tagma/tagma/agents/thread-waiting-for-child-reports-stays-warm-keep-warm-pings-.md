---
id: 01a14b6d-b261-7776-88b3-4f88d974a6b6
title: "Thread waiting for child reports stays warm: keep-warm pings until the prompt cache expires"
ord: 28
---
An agent that handed work to children and finished its turn does not lose the prompt cache while waiting: before the cache expires the server briefly wakes it, and the children's reports find it warm instead of rewriting the whole context.

**How.** The `agent.keepWarm` (on by default, operator only) and `agent.keepWarmPings` (how many pings per wait, 3 by default) settings. A wait lasts from the thread's rest to its next run for any other reason; pings are counted on the thread's own record, so a server restart does not reset the count. A ping is a short turn on the thread's model and account; the agent answers with the word `ok`, calling nothing, the turn visible in the feed.

**Limits.** Only threads on console and Anthropic subscription are pinged — only they promise a cache lifetime. A keep-warm run is not reported to the parent and is not indexed by search. Each agent's warmth is visible in `list_agents` and in cache reads.

Code: apps/tagma/server/src/native-harness/contract/wire/settings.ts#keepWarm, apps/tagma/server/src/native-harness/contract/wire/settings.ts#keepWarmPings, apps/tagma/server/src/native-harness/keepWarm, packages/agent/src/thread/run/keepWarmRun.ts, packages/agent/src/collaboration/reporting.ts#reportOwed
